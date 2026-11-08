const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

// Хранилище для всех подключенных игроков
const players = {};
// История чата (последние сообщения)
const chatHistory = [];
const MAX_HISTORY = 50;
let messageIdCounter = 0;
let adminId = null; // первый подключившийся игрок становится админом

app.use(express.static(__dirname + '/public'));

io.on('connection', (socket) => {
    console.log(`Игрок подключился: ${socket.id}`);

    // Первого игрока делаем админом
    if (!adminId) {
        adminId = socket.id;
        console.log(`Админ установлен: ${adminId}`);
    }

    players[socket.id] = {
        x: Math.floor(Math.random() * 700) + 50,
        y: Math.floor(Math.random() * 500) + 50,
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
        name: `Игрок${socket.id.substring(0, 4)}`
    };

    socket.emit('currentPlayers', players);
    socket.emit('chatHistory', chatHistory);
    socket.emit('adminStatus', socket.id === adminId);

    socket.broadcast.emit('newPlayer', { id: socket.id, info: players[socket.id] });

    // Обработка движения игрока
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            // Рассылаем новые координаты всем остальным
            socket.broadcast.emit('playerMoved', { id: socket.id, x: players[socket.id].x, y: players[socket.id].y });
        }
    });

    // Установка имени игрока
    socket.on('setName', (newName) => {
        const trimmed = (newName || '').trim();
        if (!trimmed || trimmed.length > 20) return;
        players[socket.id].name = trimmed;
        io.emit('playerRenamed', { id: socket.id, name: trimmed });
    });

    // Обработка сообщений и команд чата
    socket.on('chatMessage', (messageText) => {
        if (!players[socket.id]) return;
        const sender = players[socket.id];
        const text = messageText.trim();
        if (!text) return;

        // Личное сообщение: /w <имя> <текст> или /pm <имя> <текст>
        const dmMatch = text.match(/^(\/w|\/pm)\s+(\S+)\s+(.+)$/i);
        if (dmMatch) {
            const targetName = dmMatch[2];
            const dmText = dmMatch[3];
            const targetSocketId = Object.keys(players).find(id =>
                players[id].name && players[id].name.toLowerCase() === targetName.toLowerCase()
            );
            if (targetSocketId) {
                const dmPayload = {
                    id: ++messageIdCounter,
                    fromId: socket.id,
                    fromName: sender.name,
                    text: dmText,
                    color: sender.color,
                    private: true,
                    toId: targetSocketId,
                    timestamp: Date.now()
                };
                io.to(socket.id).emit('privateMessage', dmPayload);
                io.to(targetSocketId).emit('privateMessage', dmPayload);
            } else {
                socket.emit('chatMessageReceived', {
                    id: ++messageIdCounter,
                    fromId: 'system',
                    fromName: 'Система',
                    text: `Игрок "${targetName}" не найден или не в сети.`,
                    color: '#ff6666',
                    system: true,
                    timestamp: Date.now()
                });
            }
            return;
        }

        // Удаление сообщения админом: /delete <id> или /del <id>
        const delMatch = text.match(/^(\/delete|\/del)\s+(\d+)$/i);
        if (delMatch && socket.id === adminId) {
            const deleteId = parseInt(delMatch[2]);
            const index = chatHistory.findIndex(m => m.id === deleteId);
            if (index !== -1) {
                chatHistory.splice(index, 1);
                io.emit('messageDeleted', { messageId: deleteId });
                socket.emit('chatMessageReceived', {
                    id: ++messageIdCounter,
                    fromId: 'system',
                    fromName: 'Система',
                    text: `Сообщение #${deleteId} удалено админом.`,
                    color: '#ff6666',
                    system: true,
                    timestamp: Date.now()
                });
            } else {
                socket.emit('chatMessageReceived', {
                    id: ++messageIdCounter,
                    fromId: 'system',
                    fromName: 'Система',
                    text: `Сообщение #${deleteId} не найдено в истории.`,
                    color: '#ff6666',
                    system: true,
                    timestamp: Date.now()
                });
            }
            return;
        }

        // Обычное публичное сообщение
        const msg = {
            id: ++messageIdCounter,
            fromId: socket.id,
            fromName: sender.name,
            text: text,
            color: sender.color,
            private: false,
            timestamp: Date.now()
        };

        chatHistory.push(msg);
        if (chatHistory.length > MAX_HISTORY) {
            chatHistory.shift();
        }

        io.emit('chatMessageReceived', msg);
    });

    // Обработка отключения игрока
    socket.on('disconnect', () => {
        console.log(`Игрок отключился: ${socket.id}`);
        const wasAdmin = (socket.id === adminId);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);

        if (wasAdmin) {
            const remaining = Object.keys(players);
            if (remaining.length > 0) {
                adminId = remaining[0];
                io.emit('adminChanged', adminId);
            } else {
                adminId = null;
                io.emit('adminChanged', null);
            }
        }
    });
});

// Настройка порта: берем порт от Render (process.env.PORT) или по умолчанию 3000
const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
