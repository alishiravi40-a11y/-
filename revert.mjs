import fs from 'fs';
let code = fs.readFileSync('src/components/InvoiceForm.tsx', 'utf8');

// 1. Remove the intercept in isFormValid
code = code.replace(
`    if (type === 'sell' && isSettledWithChecks && settlementCheques.length === 0) {
      autoSubmitRef.current = true;
      setShowCheckCalculator(true);
      return;
    }

    const activeItems = items.filter(it => it.productId);`,
  "const activeItems = items.filter(it => it.productId);"
);

// 2. Remove the autoSubmitRef and effect
const effectCode = `  const autoSubmitRef = React.useRef(false);

  useEffect(() => {
    if (autoSubmitRef.current && settlementCheques.length > 0) {
      autoSubmitRef.current = false;
      performSubmit();
    }
  }, [settlementCheques]);

  const [items, setItems] = useState`;
code = code.replace(
  effectCode,
  "const [items, setItems] = useState"
);

fs.writeFileSync('src/components/InvoiceForm.tsx', code);
