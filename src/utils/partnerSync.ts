import { BusinessPartner, Person, AgencyType } from '../types';

export const syncPartnerToPerson = (partner: BusinessPartner, person: Person): Person => {
  const updatedPerson = { ...person };

  // Determine if it's an agent based on agencyType
  const isSalesAgent = partner.agencyType === AgencyType.INSTALLMENT_ONLY || partner.agencyType === AgencyType.BOTH;
  const isCreditAgent = partner.agencyType === AgencyType.CREDIT_ONLY || partner.agencyType === AgencyType.BOTH;

  updatedPerson.isAgent = isSalesAgent || isCreditAgent;
  
  if (isSalesAgent && isCreditAgent) {
    updatedPerson.role = 'both';
  } else if (isCreditAgent) {
    updatedPerson.role = 'creditor';
  } else if (isSalesAgent) {
    updatedPerson.role = 'debtor';
  } else {
    updatedPerson.role = undefined;
  }

  return updatedPerson;
};
