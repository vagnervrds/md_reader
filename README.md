# MD Reader 📖

> Leitor e editor de Markdown leve, rápido e moderno com interface web local e executável nativo.

---

## ✨ Recursos

- 🚀 **Nativo e Ultraleve:** Inicialização instantânea, baixo consumo de memória e executável único sem dependências externas.
- 📝 **Renderização Completa de Markdown:** Suporte a GitHub Flavored Markdown (GFM), tabelas, task lists, links automáticos e destaque de sintaxe (*syntax highlighting*) para dezenas de linguagens de programação.
- 🏷️ **Sistema de Tags:** Organize seus arquivos por etiquetas coloridas com filtragem rápida.
- 📂 **Monitoramento de Pastas em Tempo Real:** Sincronização automática e detecção de alterações em diretórios monitorados.
- 🎨 **Temas Customizáveis:** Suporte e instalação direta de temas comunitários do Obsidian.
- 🪟 **Integração com Windows:** Diálogos nativos do sistema e associação da extensão `.md` para abertura direta pelo Windows Explorer.
- 🔍 **Busca Rápida:** Pesquisa instantânea por nome e conteúdo dentro dos arquivos indexados.

---

## 🛠️ Tecnologias

- **Backend:** [Go (Golang)](https://go.dev/) com roteador HTTP leve, banco de dados SQLite embutido, renderizador Markdown Goldmark e monitoramento em background com Goroutines.
- **Frontend:** HTML5, CSS3 e JavaScript moderno embarcados diretamente no binário compilado via `//go:embed`.
- **Banco de Dados:** SQLite local para armazenamento de configurações, histórico de arquivos recentes, pastas e tags.

---

## 🚀 Como Usar

### Executando o aplicativo
Basta executar o binário passando (opcionalmente) um arquivo Markdown como argumento:

```bash
# Abrir o aplicativo na tela inicial
mdreader.exe

# Abrir diretamente um arquivo Markdown
mdreader.exe caminho/do/documento.md
```

Ao iniciar, o aplicativo sobe o servidor local e abre automaticamente o documento no seu navegador padrão.

---

## 📦 Como Compilar

### Pré-requisitos
- [Go](https://go.dev/dl/) instalado (versão 1.20 ou superior).
- (Opcional) Python 3 para os utilitários de release.

### Compilação no Windows
Execute o script de build para Windows:

```bat
build.bat
```
O executável final com ícone e manifesto integrados será gerado em `build/mdreader.exe`.

### Compilação no Linux / macOS
Execute o script de build para sistemas baseados em Unix:

```sh
sh build.sh
```
O binário será gerado em `build/mdreader-linux` ou `build/mdreader-macos`.

---

## 🧪 Testes

Execute a suíte de testes automatizados do backend:

```bash
go test -v ./...
```

---

## 🤖 Publicação e Release Notes com IA

Para compilar, gerar as notas de versão com base no histórico do Git e publicar no GitHub:

```bash
python generate_release_notes.py --publish
```
