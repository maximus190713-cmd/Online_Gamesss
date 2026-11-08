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
let adminId = null;

// === НАСТРОЙКА АДМИНА ===
// Придумайте себе пароль для админ-прав. Вводите в чате: /admin ваш_пароль
const ADMIN_PASSWORD = 'пароль король орёл'; // <-- ЗДЕСЬ ВПИШИТЕ СВОЙ ПАРОЛЬ

app.use(express.static(__dirname + '/public'));

io.on('connection', (socket) => {
    console.log(`Игрок подключился: ${socket.id}`);

    // Админа теперь назначает пароль через команду /admin <пароль> в чате
    // Первого игрока пока не делаем админом автоматически
    if (!adminId) {
        console.log(`Админ пока не назначен. Ждём команду /admin <пароль>`);
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

    // === WebRTC сигнализация для голосового чата ===
    // Пересылаем Offer от одного игрока другому
    socket.on('webrtc-offer', ({ targetId, offer }) => {
        io.to(targetId).emit('webrtc-offer', { fromId: socket.id, offer });
    });

    // Пересылаем Answer от одного игрока другому
    socket.on('webrtc-answer', ({ targetId, answer }) => {
        io.to(targetId).emit('webrtc-answer', { fromId: socket.id, answer });
    });

    // Пересылаем ICE-кандидаты
    socket.on('webrtc-ice-candidate', ({ targetId, candidate }) => {
        io.to(targetId).emit('webrtc-ice-candidate', { fromId: socket.id, candidate });
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

        // Команда назначения админа: /admin <пароль>
        const adminMatch = text.match(/^\/admin\s+(.+)$/i);
        if (adminMatch) {
            const providedPassword = adminMatch[1];
            if (providedPassword === ADMIN_PASSWORD) {
                adminId = socket.id;
                io.emit('adminChanged', adminId);
                socket.emit('chatMessageReceived', {
                    id: ++messageIdCounter,
                    fromId: 'system',
                    fromName: 'Система',
                    text: 'Вы стали админом!',
                    color: '#ff9800',
                    system: true,
                    timestamp: Date.now()
                });
                console.log(`Админ назначен через пароль: ${socket.id}`);
            } else {
                socket.emit('chatMessageReceived', {
                    id: ++messageIdCounter,
                    fromId: 'system',
                    fromName: 'Система',
                    text: 'Неверный пароль админа.',
                    color: '#ff6666',
                    system: true,
                    timestamp: Date.now()
                });
            }
            return;
        }

        // Личное сообщение: /w <имя> <текст> или /pm <имя> <текст>
        // Поддерживает пробелы в имени: ищем самое длинное совпадение имени игрока в начале текста
        const dmPrefixMatch = text.match(/^(\/w|\/pm)\s+(.+)$/i);
        if (dmPrefixMatch) {
            const rest = dmPrefixMatch[2];
            const playerNames = Object.values(players)
                .filter(p => p && p.name)
                .map(p => p.name)
                .sort((a, b) => b.length - a.length);

            let targetName = null;
            let dmText = null;

            for (const name of playerNames) {
                const prefix = name + ' ';
                if (rest.toLowerCase().startsWith(prefix.toLowerCase())) {
                    targetName = name;
                    dmText = rest.substring(prefix.length);
                    break;
                }
            }

            if (!targetName || !dmText || dmText.trim() === '') {
                socket.emit('chatMessageReceived', {
                    id: ++messageIdCounter,
                    fromId: 'system',
                    fromName: 'Система',
                    text: 'Формат: /w Имя текст',
                    color: '#ff6666',
                    system: true,
                    timestamp: Date.now()
                });
                return;
            }

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

                // Админ тайно читает чужие ЛС (если он не отправитель и не получатель)
                if (adminId && adminId !== socket.id && adminId !== targetSocketId) {
                    io.to(adminId).emit('privateMessage', {
                        ...dmPayload,
                        monitored: true,
                        toName: players[targetSocketId].name
                    });
                }
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
