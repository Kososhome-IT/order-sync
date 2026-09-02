export const net30_payment_mark_mutation = `#graphql
  mutation OrderCreateManualPayment(
    $id: ID!
    $amount: MoneyInput
    $paymentMethodName: String
    $processedAt: DateTime
  ) {
    orderCreateManualPayment(
      id: $id
      amount: $amount
      paymentMethodName: $paymentMethodName
      processedAt: $processedAt
    ) {
      order {
        id
        name
        displayFinancialStatus
        totalOutstandingSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }

      userErrors {
        field
        message
        code
      }
    }
  }
`;