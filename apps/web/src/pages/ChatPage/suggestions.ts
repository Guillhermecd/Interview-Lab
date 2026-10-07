// Starting points shown on an empty conversation. The tag only says what the
// question is about.
export const SUGGESTIONS = [
  { tag: 'Vendas', question: 'Qual foi o faturamento por região no último trimestre?' },
  { tag: 'Produtos', question: 'Quais são os 5 produtos mais vendidos?' },
  { tag: 'Estoque', question: 'Quais materiais estão abaixo do estoque mínimo?' },
  { tag: 'Pedidos', question: 'Como evoluiu o número de pedidos por mês?' },
  { tag: 'Entregas', question: 'Qual centro de distribuição tem mais entregas atrasadas?' },
  { tag: 'Clientes', question: 'Quais clientes mais compraram neste ano?' },
];

// The floating window has room for fewer.
const FLOATING_SUGGESTION_COUNT = 4;
export const FLOATING_SUGGESTIONS = SUGGESTIONS.slice(0, FLOATING_SUGGESTION_COUNT);
