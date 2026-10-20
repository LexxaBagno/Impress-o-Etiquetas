const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Suporte para fetch em versões do Node.js
let fetch;
if (typeof globalThis.fetch === 'function') {
    fetch = globalThis.fetch;
} else {
    fetch = require('node-fetch');
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const DIRETORIO_PROJETO = __dirname;
const DIRETORIO_MODELOS_LOCAL = path.join(DIRETORIO_PROJETO, 'modelos');
const DIRETORIO_TEMP_GITHUB = path.join(DIRETORIO_PROJETO, 'temp_github_modelos');

if (!fs.existsSync(DIRETORIO_MODELOS_LOCAL)) {
    fs.mkdirSync(DIRETORIO_MODELOS_LOCAL, { recursive: true });
}
if (!fs.existsSync(DIRETORIO_TEMP_GITHUB)) {
    fs.mkdirSync(DIRETORIO_TEMP_GITHUB, { recursive: true });
}

// Mapeamento de grupos para códigos de etiquetas (ou pode ajustar conforme a sua estrutura de pastas/grupos)
// Exemplo: se o grupo agrupa certos códigos LX
const GRUPOS_ETIQUETAS = {
    "monocomandos": ["LX1001", "LX1002"], // Ajuste aqui os códigos do seu grupo
    "chuveiros": ["LX2001", "LX2002"],
    "geral": [] // Se quiser puxar dinamicamente
};

// Rota exigida pelo HTML para carregar os grupos no <select>
app.get('/api/grupos', (req, res) => {
    try {
        // Retorna as chaves do objeto de grupos ou lista nomes de pastas
        const grupos = Object.keys(GRUPOS_ETIQUETAS);
        res.json(grupos);
    } catch (error) {
        res.status(500).json({ erro: 'Erro ao listar os grupos.' });
    }
});

// Função para buscar o modelo .btw no GitHub com fallback local
async function obterCaminhoModeloBtw(codigo) {
    const nomeArquivo = `${codigo}.btw`;
    const caminhoTemp = path.join(DIRETORIO_TEMP_GITHUB, nomeArquivo);
    const caminhoLocal = path.join(DIRETORIO_MODELOS_LOCAL, nomeArquivo);

    // 1. Tenta baixar do GitHub
    const urlGitHub = `https://raw.githubusercontent.com/LexxaBagno/Impress-o-Etiquetas/main/modelos/${nomeArquivo}`;
    try {
        const resposta = await fetch(urlGitHub);
        if (resposta.ok) {
            const bufferArray = await resposta.arrayBuffer();
            fs.writeFileSync(caminhoTemp, Buffer.from(bufferArray));
            return caminhoTemp;
        }
    } catch (e) {
        // Ignora erro de rede e tenta local
    }

    // 2. Fallback local
    if (fs.existsSync(caminhoLocal)) {
        return caminhoLocal;
    }

    return null;
}

// Rota exigida pelo HTML para efetuar a impressão do grupo selecionado
app.post('/api/imprimir', async (req, res) => {
    try {
        const { grupo } = req.body;
        if (!grupo) return res.status(400).json({ erro: 'Nenhum grupo selecionado.' });

        const codigosDoGrupo = GRUPOS_ETIQUETAS[grupo];
        if (!codigosDoGrupo || codigosDoGrupo.length === 0) {
            return res.status(400).json({ erro: 'O grupo selecionado está vazio ou não possui etiquetas associadas.' });
        }

        // Fecha instâncias anteriores do BarTender
        try {
            execSync('taskkill /f /im Bartend.exe', { stdio: 'ignore' });
        } catch (e) {}

        let impressoraPadrao = "Smart Color Print SMT-D2 (Padrão)"; // Pode ajustar ou receber via front-end se preferir
        let totalImpresso = 0;

        for (const codigo of codigosDoGrupo) {
            const caminhoBtw = await obterCaminhoModeloBtw(codigo);
            if (caminhoBtw) {
                // Comando do BarTender
                const comando = `cmd.exe /c ""C:\\Program Files\\Seagull\\BarTender 12.1\\BarTend.exe" /F="${caminhoBtw}" /PRN="${impressoraPadrao}" /C=1 /P /X"`;
                execSync(comando);
                totalImpresso++;
            }
        }

        if (totalImpresso === 0) {
            return res.status(400).json({ erro: 'Nenhum modelo .btw foi encontrado no GitHub ou localmente para este grupo.' });
        }

        res.json({ 
            sucesso: true, 
            mensagem: `Grupo "${grupo}" impresso com sucesso! (${totalImpresso} etiquetas enviadas via GitHub).` 
        });

    } catch (error) {
        console.error('Erro no servidor:', error);
        res.status(500).json({ erro: 'Erro interno ao processar a impressão: ' + error.message });
    }
});

app.listen(3000, () => {
    console.log('Servidor rodando em http://localhost:3000');
});
