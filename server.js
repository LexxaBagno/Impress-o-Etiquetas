const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let fetch = globalThis.fetch || require('node-fetch');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const DIRETORIO_TEMP = path.join(__dirname, 'temp_github_modelos');
if (!fs.existsSync(DIRETORIO_TEMP)) fs.mkdirSync(DIRETORIO_TEMP, { recursive: true });

// Rota de Grupos (ou pode adaptar para leitura de PDF)
app.get('/api/grupos', (req, res) => {
    res.json(["monocomandos", "chuveiros", "geral"]);
});

app.post('/api/imprimir', async (req, res) => {
    try {
        const { grupo } = req.body;
        // Exemplo de códigos associados ao grupo
        const codigos = ["LX1001", "LX1002"]; 

        let impressora = "Smart Color Print SMT-D2 (Padrão)";
        let total = 0;

        for (const codigo of codigos) {
            const urlGitHub = `https://raw.githubusercontent.com/LexxaBagno/Impress-o-Etiquetas/main/modelos/${codigo}.btw`;
            const caminhoLocal = path.join(DIRETORIO_TEMP, `${codigo}.btw`);

            // Baixa direto do GitHub em tempo de execução
            const resposta = await fetch(urlGitHub);
            if (resposta.ok) {
                fs.writeFileSync(caminhoLocal, Buffer.from(await resposta.arrayBuffer()));
                
                // Dispara o BarTender com o modelo baixado da nuvem
                const comando = `cmd.exe /c ""C:\\Program Files\\Seagull\\BarTender 12.1\\BarTend.exe" /F="${caminhoLocal}" /PRN="${impressora}" /C=1 /P /X"`;
                execSync(comando);
                total++;
            }
        }

        res.json({ sucesso: true, mensagem: `${total} etiquetas descarregadas do GitHub e impressas com sucesso!` });
    } catch (error) {
        res.status(500).json({ erro: 'Erro ao imprimir: ' + error.message });
    }
});

app.listen(3000, () => console.log('Agente local rodando em http://localhost:3000'));
