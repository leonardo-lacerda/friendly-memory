// WhatsApp Sender Pro - Deploy Rápido
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

console.log('🚀 Iniciando WhatsApp Sender Pro - Versão Leve');

// Configurações básicas
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logs de requisições
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Upload em memória (para cloud)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.originalname.toLowerCase().endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos CSV!'), false);
        }
    }
});

// Estado da aplicação
let appState = {
    isConnected: false,
    isSending: false,
    sendingData: {
        current: 0,
        total: 0,
        contacts: [],
        logs: []
    }
};

// Sistema de logs
function addLog(message, type = 'info') {
    const timestamp = new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo'
    });
    
    const logEntry = { timestamp, message, type };
    appState.sendingData.logs.unshift(logEntry);
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Manter apenas 30 logs
    if (appState.sendingData.logs.length > 30) {
        appState.sendingData.logs = appState.sendingData.logs.slice(0, 30);
    }
}

// Simular conexão WhatsApp
function simulateConnection() {
    setTimeout(() => {
        appState.isConnected = true;
        addLog('WhatsApp conectado (modo simulação)', 'success');
    }, 2000);
}

// ================================
// ROTAS
// ================================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
    });
});

// Conectar WhatsApp (simulação)
app.post('/api/connect', (req, res) => {
    if (appState.isConnected) {
        return res.json({ success: true, message: 'WhatsApp já conectado!' });
    }
    
    addLog('Iniciando conexão WhatsApp...');
    simulateConnection();
    res.json({ success: true, message: 'Conectando WhatsApp...' });
});

// Status do sistema
app.get('/api/status', (req, res) => {
    res.json({
        isConnected: appState.isConnected,
        isSending: appState.isSending,
        sendingData: {
            current: appState.sendingData.current,
            total: appState.sendingData.total,
            logs: appState.sendingData.logs.slice(0, 8)
        }
    });
});

// Upload CSV
app.post('/api/upload-csv', upload.single('csvFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Arquivo não enviado' });
        }
        
        // Parse CSV simples
        const csvText = req.file.buffer.toString('utf8');
        const lines = csvText.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
            return res.status(400).json({ 
                success: false, 
                error: 'CSV precisa ter pelo menos 2 linhas' 
            });
        }
        
        const contacts = [];
        
        // Pular cabeçalho, processar dados
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
            
            if (cols.length >= 2) {
                const telefone = cols[0].replace(/\D/g, '');
                const nome = cols[1] || 'Cliente';
                const mensagem = cols[2] || 'Olá!';
                
                if (telefone.length >= 10) {
                    contacts.push({
                        telefone: telefone.startsWith('55') ? telefone : '55' + telefone,
                        nome: nome,
                        mensagem: mensagem
                    });
                }
            }
        }
        
        if (contacts.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Nenhum contato válido encontrado no CSV' 
            });
        }
        
        appState.sendingData.contacts = contacts;
        appState.sendingData.total = contacts.length;
        appState.sendingData.current = 0;
        
        addLog(`CSV processado: ${contacts.length} contatos carregados`, 'success');
        
        res.json({
            success: true,
            contacts: contacts.slice(0, 5), // Preview
            total: contacts.length
        });
        
    } catch (error) {
        addLog(`Erro no CSV: ${error.message}`, 'error');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Iniciar envio
app.post('/api/start-sending', async (req, res) => {
    try {
        const { delay = 5000, startTime, customMessage } = req.body;
        
        if (!appState.isConnected) {
            return res.status(400).json({ 
                success: false, 
                error: 'WhatsApp não está conectado' 
            });
        }
        
        if (appState.sendingData.contacts.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Carregue um arquivo CSV primeiro' 
            });
        }
        
        if (appState.isSending) {
            return res.status(400).json({ 
                success: false, 
                error: 'Já existe um envio em andamento' 
            });
        }
        
        // Agendamento
        if (startTime) {
            const now = new Date();
            const [hours, minutes] = startTime.split(':').map(Number);
            const target = new Date();
            target.setHours(hours, minutes, 0, 0);
            
            if (target <= now) target.setDate(target.getDate() + 1);
            
            const waitMs = target - now;
            if (waitMs > 0) {
                addLog(`Envio agendado para ${startTime}`);
                setTimeout(() => startSending(delay, customMessage), waitMs);
                return res.json({ 
                    success: true, 
                    message: `Envio agendado para ${startTime}` 
                });
            }
        }
        
        // Iniciar imediatamente
        startSending(delay, customMessage);
        res.json({ success: true, message: 'Envio iniciado!' });
        
    } catch (error) {
        addLog(`Erro ao iniciar envio: ${error.message}`, 'error');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Parar envio
app.post('/api/stop-sending', (req, res) => {
    appState.isSending = false;
    addLog('Envio interrompido pelo usuário');
    res.json({ success: true, message: 'Envio parado!' });
});

// Logs completos
app.get('/api/logs', (req, res) => {
    res.json({ 
        logs: appState.sendingData.logs,
        total: appState.sendingData.logs.length
    });
});

// ================================
// FUNÇÃO DE ENVIO (SIMULAÇÃO)
// ================================
async function startSending(delay, customMessage) {
    appState.isSending = true;
    appState.sendingData.current = 0;
    
    const total = appState.sendingData.contacts.length;
    addLog(`Iniciando envio para ${total} contatos`, 'success');
    
    for (let i = 0; i < total && appState.isSending; i++) {
        const contact = appState.sendingData.contacts[i];
        
        try {
            let message = customMessage || contact.mensagem;
            message = message.replace(/\{nome\}/g, contact.nome);
            
            addLog(`Enviando para ${contact.nome} (${contact.telefone})`);
            
            // Simular envio
            await new Promise(resolve => setTimeout(resolve, 800));
            
            // 95% de sucesso
            if (Math.random() < 0.95) {
                addLog(`✅ Enviado para ${contact.nome}`, 'success');
            } else {
                throw new Error('Número inválido');
            }
            
            appState.sendingData.current = i + 1;
            
            // Delay entre mensagens
            if (i < total - 1 && appState.isSending) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
        } catch (error) {
            addLog(`❌ Falha para ${contact.nome}: ${error.message}`, 'error');
            appState.sendingData.current = i + 1;
            
            // Continua com delay menor
            if (i < total - 1 && appState.isSending) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
    
    if (appState.isSending) {
        addLog(`🎉 Envio concluído! ${appState.sendingData.current}/${total}`, 'success');
    }
    
    appState.isSending = false;
}
