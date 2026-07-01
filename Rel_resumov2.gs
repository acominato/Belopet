//rel_resumov2.gs
function rel_resumov2(e) {
  var ss = SpreadsheetApp.openById("112Dm9XVjPwFFBkMLOC0_Q9lacmXJlAcQk3Cuh3nei64");
  var sheet = ss.getSheetByName("DadosClientes");
  var data = sheet.getDataRange().getValues();

  var inicio = new Date(e.parameter.inicio + "T00:00:00");
  var fim = new Date(e.parameter.fim + "T23:59:59");
  var filtroSentido = e.parameter.sentido || "";
  var filtroCidade = (e.parameter.cidade || "").toUpperCase().trim();

  var resultado = data.slice(1).filter(function(row) {
    var dataLinha = new Date(row[1]);
    var dePara = String(row[2]).toUpperCase();
    var sentidoLinha = String(row[3]);
    var dataOk = dataLinha >= inicio && dataLinha <= fim;
    var sentidoOk = filtroSentido === "" || sentidoLinha === filtroSentido;
    var cidadeOk = filtroCidade === "" || dePara.includes(filtroCidade);
    return dataOk && sentidoOk && cidadeOk;
  });

  // OrdenaÃ§Ã£o: Data primeiro, EndereÃ§o segundo
  resultado.sort(function(a, b) {
    var dataA = new Date(a[1]);
    var dataB = new Date(b[1]);

    if (dataA.getTime() !== dataB.getTime()) return dataA - dataB;

    var partesA = String(a[2]).toUpperCase().split(" X ");
    var isDesA = (partesA.length >= 2 && partesA[1].trim() === filtroCidade);
    var endA = String(isDesA ? a[22] : a[17]);

    var partesB = String(b[2]).toUpperCase().split(" X ");
    var isDesB = (partesB.length >= 2 && partesB[1].trim() === filtroCidade);
    var endB = String(isDesB ? b[22] : b[17]);

    return endA.localeCompare(endB);
  });

  var dadosFinais = resultado.map(function(row) {
    var partes = String(row[2]).toUpperCase().split(" X ");
    var isDes = (partes.length >= 2 && partes[1].trim() === filtroCidade);

    return [
      isDes ? "DES" : "EMB", // Tipo
      row[18],               // Apoio - coluna S
      Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), "dd/MM/yyyy"),
      row[3],                // Sentido
      row[2],                // DE/PARA
      row[11],               // Dados Pet
      row[12],               // QTD
      row[13],               // Caixa
      isDes ? row[22] : row[17], // EndereÃ§o
      isDes ? row[20] : row[15], // Telefone
      isDes ? row[19] : row[14]  // ResponsÃ¡vel
    ];
  });

  dadosFinais.unshift([
    "Tipo",
    "Apoio",
    "Data",
    "Sentido",
    "DE/PARA",
    "Dados Pet",
    "QTD",
    "Caixa",
    "Endereço",
    "Telefone",
    "Responsável"
  ]);

  return ContentService
    .createTextOutput(JSON.stringify(dadosFinais))
    .setMimeType(ContentService.MimeType.JSON);
}
