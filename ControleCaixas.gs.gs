//controleCaixas.gs.gs
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("BeloPet")
    .addItem("Abrir Cadastro (DadosClientes)", "BP_openDadosClientesSidebar")
    .addItem("Atualizar controle de caixas", "atualizarControleCaixas")
    .addToUi();
}
function atualizarControleCaixas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const origem = ss.getSheetByName("DadosClientes");

  if (!origem) {
    SpreadsheetApp.getUi().alert("Aba DadosClientes não encontrada.");
    return;
  }

  const dados = origem.getDataRange().getValues();
  const header = dados[0];

  const idxData = header.indexOf("Data Viagem");
  const idxDePara = header.indexOf("DE/PARA");
  const idxSentido = header.indexOf("Sentido");
  const idxDadosPet = header.indexOf("Dados Pet");
  const idxCaixa = header.indexOf("Caixa");
const idxQtdePets = header.indexOf("Qtde Pets");

  if ([idxData, idxDePara, idxSentido, idxDadosPet, idxCaixa].includes(-1)) {
    SpreadsheetApp.getUi().alert("Alguma coluna obrigatória não foi encontrada.");
    return;
  }

  const dataFiltro = new Date("2026-05-04");
  const sentidoFiltro = "SOBE";

  const expandidas = [["Data", "Sentido", "DE/PARA", "Dados Pet", "Caixa"]];

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];

    const data = linha[idxData];
    const sentido = String(linha[idxSentido] || "").trim().toUpperCase();
    const depara = linha[idxDePara];
    const dadosPet = linha[idxDadosPet];
    const caixaRaw = linha[idxCaixa];

    if (!(data instanceof Date)) continue;
    if (data < dataFiltro) continue;
    if (sentido !== sentidoFiltro) continue;
    if (!caixaRaw) continue;

    const caixas = String(caixaRaw).match(/\d+/g);
if (!caixas) continue;

const qtdePets = Number(linha[idxQtdePets]) || 1;

// Se informou uma única caixa e vários pets, repete a caixa pela quantidade de pets
if (caixas.length === 1 && qtdePets > 1) {
  for (let j = 0; j < qtdePets; j++) {
    expandidas.push([
      data,
      sentido,
      depara,
      dadosPet,
      Number(caixas[0])
    ]);
  }
} else {
  // Se escreveu "4 e 5", "3 3", etc., cada número vira uma caixa
  caixas.forEach(caixa => {
    expandidas.push([
      data,
      sentido,
      depara,
      dadosPet,
      Number(caixa)
    ]);
  });
}
  }

  criarOuLimparAba(ss, "CAIXAS_EXPANDIDAS", expandidas);
  gerarOcupacao(ss, expandidas);
  gerarCaixas45(ss, expandidas);

  SpreadsheetApp.getUi().alert("Controle de caixas atualizado com sucesso.");
}

function criarOuLimparAba(ss, nome, valores) {
  let aba = ss.getSheetByName(nome);
  if (!aba) aba = ss.insertSheet(nome);

  aba.clearContents();
  aba.getRange(1, 1, valores.length, valores[0].length).setValues(valores);
  aba.getRange(1, 1, 1, valores[0].length).setFontWeight("bold");
  aba.autoResizeColumns(1, valores[0].length);
}

function gerarOcupacao(ss, expandidas) {
  const estoque = {
    2: 7,
    3: 4,
    4: 4,
    5: 10,
    6: 2
  };

  const contagem = {};

  for (let i = 1; i < expandidas.length; i++) {
    const caixa = expandidas[i][4];
    contagem[caixa] = (contagem[caixa] || 0) + 1;
  }

  const resultado = [["Nº Caixa", "Qtde na Van", "Qtde Usada", "Saldo", "Status"]];

  Object.keys(estoque).forEach(caixa => {
    const usada = contagem[caixa] || 0;
    const saldo = estoque[caixa] - usada;

    let status = "🟢 OK";
if (saldo === 0) status = "🟡 LIMITE";
if (saldo < 0) status = "🔴 ESTOURO";

    resultado.push([
      Number(caixa),
      estoque[caixa],
      usada,
      saldo,
      status
    ]);
  });

  criarOuLimparAba(ss, "OCUPACAO_CAIXAS", resultado);
}

function gerarCaixas45(ss, expandidas) {
  const resultado = [["DE/PARA", "Dados Pet", "Caixa"]];

  for (let i = 1; i < expandidas.length; i++) {
    const caixa = expandidas[i][4];

    if (caixa === 4 || caixa === 5) {
      resultado.push([
        expandidas[i][2],
        expandidas[i][3],
        caixa
      ]);
    }
  }

  criarOuLimparAba(ss, "CAIXAS_4_5", resultado);
}