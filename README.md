GeraContrato.gs
→ antigo
→ execução dentro da planilha
→ geração em lote

ContratoWeb.gs
→ atual
→ chamado pela tela clientes.html
→ geração individual

Clientes.gs
→ Web App
→ recebe as chamadas das telas
→ chama o ContratoWeb.gs
→ será onde adicionaremos a consulta ao tarifário

HTML Calculadora
        │
        ▼
Clientes.gs   ← único WebApp
        │
        ├── DadosClientes
        ├── PontosEncontro
        ├── DENIT      ← vamos adicionar
        ├── ContratoWeb.gs
        └── CRM


index.html
├── clientes.html
│   └── Web App: ...L1kOV/exec
│
├── calcb.html
│   └── Web App: ...OolpIi/exec so usado no crm e está desativado
│
├── rel_resumo.html
│   └── Web App: ...SO7qd/exec
│
├── Comparativo_caixas.html
│   └── Web App: ...SO7qd/exec
│
└── pontos.html
    └── leitura direta da planilha via Google Visualization / gviz
        
