function limparApostrofosDadosClientes() {
  const ss = SpreadsheetApp.openById("112Dm9XVjPwFFBkMLOC0_Q9lacmXJlAcQk3Cuh3nei64");
  const sh = ss.getSheetByName("DadosClientes");

  const cols = [
    7,  // CPF
    10, // Telefone
    16, // Telefone Resp Embarque
    21  // Telefone Resp Desembarque
  ];

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  cols.forEach(col => {
    const range = sh.getRange(2, col, lastRow - 1, 1);
    const values = range.getDisplayValues();

    const limpos = values.map(r => {
      let v = String(r[0] || "").trim();
      v = v.replace(/^'/, "");
      return [v];
    });

    range.setNumberFormat("@"); // texto
    range.setValues(limpos);
  });

  SpreadsheetApp.getUi().alert("CPF e telefones limpos e formatados como texto.");
}