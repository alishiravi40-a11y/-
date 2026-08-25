# SYSTEM CONTEXT & FINANCIAL SYSTEM ARCHITECTURE (GEMINI.md)

This document serves as the master architectural specification, operational invariant ledger, and context anchor for the full-stack financial accounting, installment management, and credit operations application.

---

## 1. Core Architectural Paradigm & Tech Stack

- **Runtime & Backend**: Node.js, Express (`server.ts`), TypeScript (`tsx`), bundled with `esbuild` to CommonJS (`dist/server.cjs`).
- **Database & Storage**: PostgreSQL via Supabase with Row Level Security (RLS) and transactional `SECURITY DEFINER` RPCs.
- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Motion.
- **Calendar & Time**: Strict Solar Hijri (Jalali) standard calendar for all business dates and accounting periods.

---

## 2. Mandatory Financial & Accounting Invariants

### 2.1 Double-Entry Balance Invariant
- **Rule**: Every single accounting journal voucher MUST maintain mathematical balance:
  $$\sum \text{Debit} = \sum \text{Credit}$$
- **Database Enforcement**: Any insertion or modification resulting in `SUM(debit) !== SUM(credit)` MUST fail closed and rollback atomically with code `ERR_VOUCHER_UNBALANCED`.
- **Zero-Sum Validation**: Rounding issues or fractional differences are strictly forbidden; amounts must be integer minor currency units (Rials).

### 2.2 Immutability & Reversals (Append-Only Ledger)
- **Rule**: Posted journal vouchers (`JournalVoucher`) are immutable.
- **Correction Protocol**: Direct editing or deletion of financial entries in posted vouchers is strictly prohibited. Corrections must occur exclusively through formal, balanced reversal vouchers (`reversalVoucherId`) linked to the original document.

### 2.3 Strict Chart of Accounts (COA) Structure
- **Hierarchical Classification**: Account Groups (گروه) $\rightarrow$ General Accounts (کل) $\rightarrow$ Subsidiary Accounts (معین) $\rightarrow$ Floating Detailed Accounts (تفصیلی شناور).
- **Core Subsidiary Keys**:
  - `SUB_DEBTORS`: بدهکاران تجاری (حساب‌های دریافتنی عادی)
  - `SUB_DEBTORS_INSTALLMENT`: بدهکاران اقساطی (پرونده‌های اعتباری و اقساط)
  - `SUB_DEBTORS_AGENTS`: بدهکاران فروش نمایندگان
  - `SUB_CREDITORS`: بستانکاران تجاری (تامین‌کنندگان، نمایندگان و همکاران)
  - `SUB_CHECKS_REC`: اسناد دریافتنی نزد صندوق
  - `SUB_CHECKS_REC_IN_TRANSIT`: اسناد دریافتنی در جریان وصول
  - `SUB_CHECKS_PAY`: اسناد پرداختنی (چک‌های صادره)
  - `SUB_BANK`: موجودی حساب‌های بانکی
  - `SUB_CASH`: موجودی صندوق

---

## 3. Server-Authoritative Architecture & Single Source of Truth (SSOT)

### 3.1 Prohibition of Client-Side Financial Mutations
- **Rule**: Client-side local storage (`localStorage`, in-memory `AppState` array pushes in React components) is **STRICTLY FORBIDDEN** for persistent financial record-keeping.
- **Authoritative Flow**: All financial mutations (vouchers, invoice cutovers, cheque transitions, installment settlements, customer dossiers) must be initiated through server-side REST API endpoints (`/api/*`) executing signed, atomic PostgreSQL RPC functions.
- **Client Role**: The client UI is purely a presentation, validation, and interaction layer that hydrates its state from server-authoritative responses.

### 3.2 Secret Key Quarantining
- `SUPABASE_SERVICE_ROLE_KEY` and third-party secrets must NEVER be prefixed with `VITE_` or bundled into client-side code. All privileged database operations reside strictly on the server boundary.

---

## 4. Database Security, Multi-Tenancy & Row Level Security (RLS)

### 4.1 Strict Table Locking via RLS
- **Rule**: Direct client `INSERT`, `UPDATE`, and `DELETE` queries on core financial tables (`journal_vouchers`, `voucher_entries`, `cheques`, `cheque_mutations`, `invoices`, `installment_books`, `installments`) are blocked via PostgreSQL RLS policies enforcing `USING (false)`.
- **Privileged Access**: Only server-authenticated service contexts invoking PostgreSQL `SECURITY DEFINER` stored procedures can write to the ledger.

### 4.2 Multi-Tenant Organization Isolation
- Every table row and ledger entry MUST be bound to a verified `organization_id`.
- Cross-tenant data leakage is prevented via strict PostgreSQL session variables (`app.current_organization_id`) and parameter verification in every RPC.

---

## 5. Concurrency, Locking & Idempotency

### 5.1 Pessimistic Concurrency & Row-Level Locking
- Any operation altering credit limits, cheque states, invoice totals, or installment books must execute within an explicit database transaction using:
  ```sql
  SELECT * FROM target_table WHERE id = target_id FOR UPDATE;
  ```
- This prevents race conditions, double-allocations, and limit breaches under high-concurrency environments.

### 5.2 Deterministic Idempotency & Operation Keys
- Every mutating request must generate and transmit a deterministic `operation_key` or `request_fingerprint`.
- Re-transmitting or retrying a transaction with an identical `operation_key` must return the existing transaction record without creating duplicate journal vouchers, double-charging banks, or re-incrementing version counters.

---

## 6. Credit Control, Role Isolation & Customer Settlement Gate

### 6.1 Central Settlement Gate (`checkCustomerCreditEligibility`)
- Before finalizing any direct credit file (`CreditFile`) or partner credit request (`PartnerCreditRequest`), the system must verify real financial settlement across:
  1. **Ledger Balance**: Real debit balance in `SUB_DEBTORS_INSTALLMENT` and `SUB_DEBTORS` via `calculatePersonBalances`.
  2. **Installments**: Verification that all previous installments have `status === 'paid'` (ignoring text statuses of booklets).
  3. **Received Cheques**: Ensuring no active in-flight or bounced cheques exist (`present_in_cashbox`, `deposited_to_bank`, `bounced`, `passed_to_others`).
  4. **Active Dossiers**: Ensuring no unfinished parallel files exist.

### 6.2 Strict Non-Clearing of Roles (No Role Offsetting)
- **Invariant**: A person acting in multiple roles (e.g. customer with debit debt and agent with credit commission) MUST NOT have their debts offset against credits.
- Creditor balance in `SUB_CREDITORS` can never reduce or cancel a customer's debit liability in `SUB_DEBTORS_INSTALLMENT`.

---

## 7. Received Cheque Lifecycle State Machine

1. `present_in_cashbox` (موجود در صندوق): Initial state upon reception $\rightarrow$ Debits `SUB_CHECKS_REC`, Credits `SUB_DEBTORS`.
2. `deposited_to_bank` (واگذار به بانک): In-transit to bank $\rightarrow$ Debits `SUB_CHECKS_REC_IN_TRANSIT`, Credits `SUB_CHECKS_REC`.
3. `cleared` (وصول شده): Cleared at bank $\rightarrow$ Debits `SUB_BANK`, Credits `SUB_CHECKS_REC_IN_TRANSIT`.
4. `passed_to_others` (خرج شده به غیر): Endorsed to supplier $\rightarrow$ Debits `SUB_CREDITORS`, Credits `SUB_CHECKS_REC`.
5. `bounced` (برگشتی): Returned unpaid $\rightarrow$ Re-establishes customer debit in `SUB_DEBTORS` against `SUB_CHECKS_REC`.

---

## 8. Verification & Quality Mandates

- **Build Integrity**: `npm run test` and `npm run build` must compile cleanly without TypeScript errors (`tsc --noEmit`) or unhandled promise rejections.
- **Zero Regression**: Any modification to financial routines must be accompanied by rigorous automated regression tests in `src/tests/`.
