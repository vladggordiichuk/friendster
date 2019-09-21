const express = require('express');
const router = express.Router();
const db = require('./db');
const mysql = require('./mysql');
const Joi = require('joi');
const passwordHash = require('password-hash');

const currentTimestamp = Math.round(new Date().getTime()/1000);

router.post('/', (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (['setOnline',
        'setOffline',
        'login',
        'register',
        'searchUser',
        'searchMsg',
        'loadMsgs',
        'sendMsg',
        'removeMsg',
        'setSeen',
        'sendDiscussion',
        'loadDiscussion',
        'createRoom'].includes(req.body.action)) new API(req, res);
    else
        res.send(JSON.stringify({error : 'Action parameter missing or does not exist.'}));
});


class API {
    constructor(req, res) {
        this.req = req;
        this.res = res;
        var action = req.body.action;

        delete req.body.action;
        Object.keys(req.body).map(function(key, index) {
            req.body[key] = encodeURIComponent(req.body[key]);
        });

        this.params = req.body;
        eval('this.' + action + '()');
    }

    output(something) {
        return this.res.send(JSON.stringify(something));
    }

    setOnline() {
        const { websocket } = this.params;
        if (this.req.session.user) {
            this.req.session.user.websocket = websocket;
            mysql('UPDATE users SET websocket=? WHERE id=?', [websocket, this.req.session.user.id]);
            this.output({status: 'online'});
        } else this.output({error: 'noUserData'});
    }

    setOffline() {
        if (this.req.session.user) {
            mysql('UPDATE users SET websocket="" WHERE id=?', [this.req.session.user.id]);
            this.output({status: 'offlineByUserId', action: 'userLeft', userId: this.req.session.user.id});
            this.req.session.destroy();
        } else this.output({error: 'You\'re not logged in'});
    }

    login() {
        const { username, password } = this.params;
        const { error, value } = userJoiScheme.validate({ username: username, password: password });

        if (error) return this.output({error: error.message});

        db.query('SELECT * FROM `users` WHERE `username` = ?', [username], (error, results, fields) => {

            if (results.length != 1) return this.output({error: 'User not found'});

            if (!passwordHash.verify(password, results[0].password)) return this.output({error: 'Wrong password'});

            var user = new User(decodeURIComponent(results[0].id), decodeURIComponent(results[0].first_name), decodeURIComponent(results[0].last_name), decodeURIComponent(results[0].username), decodeURIComponent(results[0].photo));
            this.req.session.user = user;
            this.output(user);
        });
    }

    register() {
        const { first_name, last_name, username, password, photo } = this.params;
        const { error, value } = userJoiScheme.validate({ first_name: first_name, last_name: last_name, username: username, password: password, photo: photo });

        if (error) return this.output({error: error.message});

        db.query('SELECT COUNT(*) AS sum FROM `users` WHERE `username` = ?', [username], (error, results, fields) => {
            if (results[0].sum > 0) return this.output({error: 'User is already registered'});

            db.query('INSERT INTO `users` (`first_name`, `last_name`, `username`, `password`, `photo`, `lastOnline`) VALUES (?, ?, ?, ?, ?, ?)', [first_name, last_name, username, passwordHash.generate(password), photo, currentTimestamp], (error, results) => {
                var user = new User(decodeURIComponent(results.insertId), decodeURIComponent(first_name), decodeURIComponent(last_name), decodeURIComponent(username), decodeURIComponent(photo));
                this.req.session.user = user;
                this.output(user);
            });
        });
    }

    searchUser() {
        const { q } = this.params;

        db.query('SELECT id, first_name, last_name, username, websocket, photo FROM users WHERE username LIKE ? AND id != ? LIMIT 0,5', ['%' + q + '%', this.req.session.user.id], (error, results, fields) => {
            var users = [];
            results.forEach((element, index) => {
                users[index] = {};
                Object.keys(element).map(function(objectKey, idx) {
                    users[index][objectKey] = decodeURIComponent(element[objectKey]);
                });
            });
            this.output(users);
        });
    }

    async searchMsg() {
        const { q } = this.params;

        await db.query('SELECT message, timestamp, fromId, toUserId FROM messages WHERE (fromId = ? OR toUserId = ?) AND message LIKE ? ORDER BY timestamp DESC LIMIT 0,5', [this.req.session.user.id, this.req.session.user.id, '%' + q + '%'], async (error, results, fields) => {
            var msgs = [];
            for (let key in results) {
                let user = await mysql('SELECT id, websocket, photo FROM users WHERE id = ?', [(results[key].fromId == this.req.session.user.id ? results[key].toUserId : results[key].fromId)]);

                
                msgs[key] = {};
                msgs[key].id = decodeURIComponent(user[0].id);
                msgs[key].websocket = decodeURIComponent(user[0].websocket);
                msgs[key].photo = decodeURIComponent(user[0].photo);

                msgs[key].message = decodeURIComponent(results[key].message);

                var a = await new Date(results[key].timestamp * 1000);
                msgs[key].date = a.getHours() + ':' + a.getMinutes() + ' ' + a.getDate() + ' ' + (a.getMonth() + 1) + ' ' + a.getFullYear();
                
            }
            this.output(msgs);
        });
    }

    loadMsgs() {
        const { type, chatId } = this.params;

        if (type == 'user') {
            db.query('SELECT *, (SELECT COUNT(*) FROM `discussions` WHERE msgId=messages.id) AS countDiscussion FROM messages WHERE id IN (SELECT id FROM messages WHERE fromId=? AND toUserId=?) OR id IN (SELECT id FROM messages WHERE fromId=? AND toUserId=?) ORDER BY timestamp ASC', [chatId, this.req.session.user.id, this.req.session.user.id, chatId], (error, msgs, fields) => {
                db.query('SELECT * FROM users WHERE id=?', [chatId], (error, usersFriend, fields) => {
                    db.query('UPDATE messages SET seen=1 WHERE fromId=? AND toUserId=?', [chatId, this.req.session.user.id]);

                    let friendData = {};
                    friendData.id = usersFriend[0].id;
                    friendData.first_name = decodeURIComponent(usersFriend[0].first_name);
                    friendData.last_name = decodeURIComponent(usersFriend[0].last_name);
                    friendData.photo = decodeURIComponent(usersFriend[0].photo);
                    friendData.username = decodeURIComponent(usersFriend[0].username);
                    friendData.websocket = decodeURIComponent(usersFriend[0].websocket);

                    this.output({msgs: msgs, friend: friendData, me: this.req.session.user})
                });
            });
        } else if (type == 'room') {
            db.query('SELECT messages.id, messages.message, messages.timestamp, users.websocket, users.first_name, users.photo, IF(STRCMP(?, messages.fromId), "", "me") AS me, (SELECT COUNT(*) FROM `discussions` WHERE msgId=messages.id) AS countDiscussion FROM messages INNER JOIN users ON users.id=messages.fromId WHERE toRoomId=? ORDER BY timestamp ASC', [this.req.session.user.id, chatId], (error, msgs, fields) => {
                this.output(msgs);
            });
        }
    }

    async sendMsg() {
        const { msg, type, chatId, forwardedMsgId } = this.params;
        const sessionUserId = this.req.session.user.id;
        var messageForw = '';

        if (type == 'user') {
            if (forwardedMsgId) {
                let forwardUser = await mysql('SELECT * FROM users WHERE id=(SELECT fromId FROM messages WHERE id=?)', [forwardedMsgId]);
                let message = await mysql('SELECT message FROM messages WHERE id=?', [forwardedMsgId]);

                messageForw = '<b>By @' + forwardUser[0].username + '</b><br>' + message[0].message;
            }
            db.query('INSERT INTO `messages`(`fromId`, `toUserId`, `toRoomId`, `message`, `seen`, `forward`, `timestamp`) VALUES (?, ?, -1, ?, 0, ?, ?)', [sessionUserId, chatId, (msg ? msg : messageForw), (forwardedMsgId ? forwardedMsgId : '-1'), currentTimestamp], async (error, results) => {
                await db.query('SELECT * FROM users WHERE id=?', [chatId], async (error, toUser, fields) => {
                    let to = await mysql('SELECT websocket FROM users WHERE websocket!="" AND id=?', [chatId]);

                    if (to && to[0]) {
                        this.output({
                            action: 'msg',
                            msg: decodeURIComponent(msg ? msg : messageForw),
                            msgId: results.insertId,
                            from: this.req.session.user,
                            type: 'user',
                            toUserData: {
                                first_name: decodeURIComponent(toUser[0].first_name),
                                last_name: decodeURIComponent(toUser[0].last_name),
                                photo: decodeURIComponent(toUser[0].photo),
                                id: toUser[0].id
                            },
                            to: [to[0]['websocket']]
                        });
                    } else {
                        this.output({
                            action: 'msg',
                            msg: decodeURIComponent(msg ? msg : messageForw),
                            msgId: results.insertId,
                            from: this.req.session.user,
                            type: 'user',
                            toUserData: {
                                first_name: decodeURIComponent(toUser[0].first_name),
                                last_name: decodeURIComponent(toUser[0].last_name),
                                photo: decodeURIComponent(toUser[0].photo),
                                id: toUser[0].id
                            },
                        });
                    }
                });
            });
        } else if (type == 'room') {
            db.query('INSERT INTO `messages`(`fromId`, `toUserId`, `toRoomId`, `message`, `seen`, `forward`, `timestamp`) VALUES (?, -1, ?, ?, 1, -1, ?)', [sessionUserId, chatId, msg, currentTimestamp], async (error, results) => {
                let roomData = await mysql('SELECT * FROM rooms WHERE id=?', [chatId]);
                let toWebsockets = await mysql('SELECT users.websocket FROM `roomMembers` INNER JOIN `users` ON roomMembers.userId=users.id WHERE users.websocket!="" AND roomMembers.roomId=?', [chatId]);
                let to = [];

                for (let websocket of toWebsockets) {
                    if (websocket['websocket'] != this.req.session.user.websocket)
                        to.push(websocket['websocket']);
                }

                this.output({
                    action: 'msg',
                    msg: decodeURIComponent(msg),
                    msgId: results.insertId,
                    chatId: chatId,
                    from: this.req.session.user,
                    type: 'room',
                    title: decodeURIComponent(roomData[0].name),
                    photo: decodeURIComponent(roomData[0].photo),
                    to: to
                });
            });
        }
    }

    async removeMsg() {
        const { msgId, type, chatId } = this.params;
        const sessionUserId = this.req.session.user.id;

        if (type == 'user') {
            db.query('DELETE FROM `discussions` WHERE msgId=?', [msgId]);
            db.query('DELETE FROM `messages` WHERE id=?', [msgId]);
            let lastMsg = await mysql('SELECT message, timestamp FROM messages WHERE id IN (SELECT id FROM messages WHERE fromId=? AND toUserId=?) OR id IN (SELECT id FROM messages WHERE fromId=? AND toUserId=?) ORDER BY timestamp DESC', [chatId, sessionUserId, sessionUserId, chatId]);
            let unseen = await mysql('SELECT COUNT(*) FROM messages WHERE id IN (SELECT id FROM messages WHERE fromId=? AND toUserId=? AND seen=0)', [sessionUserId, chatId]);
            let to = await mysql('SELECT websocket FROM users WHERE id=?', [chatId]);

            if (lastMsg) {
                this.output({
                    action: 'removeMsg',
                    type: type,
                    msgId: msgId,
                    unseen: unseen[0]['COUNT(*)'],
                    to: [to[0]['websocket']],
                    fromId: sessionUserId,
                    lastMsg: (lastMsg ? lastMsg[0] : null)
                });
            } else {
                this.output({
                    action: 'removeMsg',
                    type: type,
                    msgId: msgId,
                    unseen: unseen[0]['COUNT(*)'],
                    to: [to[0]['websocket']],
                    fromId: sessionUserId
                });
            }
        } else if (type == 'room') {
            db.query('DELETE FROM `discussions` WHERE msgId=?', [msgId]);
            db.query('DELETE FROM `messages` WHERE id=?', [msgId]);
            let lastMsg = await mysql('SELECT message, timestamp FROM messages WHERE toRoomId=? ORDER BY timestamp DESC', [chatId]);

            let toWebsockets = await mysql('SELECT users.websocket FROM `roomMembers` INNER JOIN `users` ON roomMembers.userId=users.id WHERE users.websocket!="" AND roomMembers.roomId=?', [chatId]);
                let to = [];

                for (let websocket of toWebsockets) {
                    if (websocket['websocket'] != this.req.session.user.websocket)
                        to.push(websocket['websocket']);
                }

            if (lastMsg) {
                this.output({
                    action: 'removeMsg',
                    type: type,
                    msgId: msgId,
                    fromId: chatId,
                    to: to,
                    lastMsg: (lastMsg ? lastMsg[0] : null)
                });
            } else {
                mysql('DELETE FROM `rooms` WHERE id=?', [chatId]);
                mysql('DELETE FROM `roomMembers` WHERE roomId=?', [chatId]);
                this.output({
                    action: 'removeMsg',
                    type: type,
                    msgId: msgId,
                    fromId: chatId,
                    to: to
                });
            }
        }
    }

    setSeen() {
        const { chatId } = this.params;
        db.query('UPDATE messages SET seen=1 WHERE fromId=? AND toUserId=?', [chatId, this.req.session.user.id]);
    }

    async sendDiscussion() {
        const { discussion, msgId } = this.params;
        const sessionUserId = this.req.session.user.id;

        db.query('INSERT INTO `discussions`(`msgId`, `fromId`, `message`, `timestamp`) VALUES (?, ?, ?, ?)', [msgId, sessionUserId, discussion, currentTimestamp]);

        let to = await mysql('SELECT toUserId, websocket FROM `messages` INNER JOIN `users` ON messages.toUserId=users.id WHERE messages.id=?', [msgId]);

        if (to && to[0] && parseInt(to[0].toUserId) > 0) {
            if (parseInt(to[0].toUserId) != parseInt(sessionUserId))
                to = [to[0].websocket];
            else {

                to = await mysql('SELECT websocket FROM `messages` INNER JOIN `users` ON messages.fromId=users.id WHERE messages.id=?', [msgId]);
                to = [to[0].websocket];
            }
        } else {
            let members = await mysql('SELECT userId, websocket FROM `roomMembers` INNER JOIN `users` ON roomMembers.userId=users.id WHERE roomId=(SELECT toRoomId FROM messages WHERE messages.id=?)', [msgId]);
            to = [];

            for (let member of members) {
                if (parseInt(member.userId) != parseInt(sessionUserId))
                    to.push(member.websocket);
            }
        }

        this.output({
            action: 'discussion',
            msgId: msgId,
            msg: decodeURIComponent(discussion),
            userImg: this.req.session.user.photo,
            userFirstName: this.req.session.user.first_name,
            to: to
        });
    }

    async loadDiscussion() {
        const { msgId } = this.params;
        let msgs = await mysql('SELECT * FROM discussions INNER JOIN `users` ON discussions.fromId=users.id WHERE msgId=? ORDER BY timestamp ASC', [msgId]);

        for (let key in msgs) {
            msgs[key].first_name = decodeURIComponent(msgs[key].first_name);
            msgs[key].last_name = decodeURIComponent(msgs[key].last_name);
            msgs[key].photo = decodeURIComponent(msgs[key].photo);
            msgs[key].message = decodeURIComponent(msgs[key].message);

            if (msgs[key].fromId == this.req.session.user.id)
                msgs[key].isMe = true;
            else
                msgs[key].isMe = false
        }

        this.output(msgs);
    }

    async createRoom() {
        let { title, photo, members } = this.params;
        const sessionUserId = this.req.session.user.id;
        const { error, value } = roomJoiScheme.validate({ title: title, photo: photo });

        if (error) return this.output({error: error.message});

        members = JSON.parse(decodeURIComponent(members));
        members = members.filter(member => parseInt(member) != sessionUserId);
        
        if (members.length < 1) return this.output({error: 'Invite room members'});


        db.query('INSERT INTO `rooms`(`name`, `photo`) VALUES (?, ?)', [title, photo], async (error, results) => {
            let lastId = results.insertId;
            db.query('INSERT INTO `roomMembers`(`roomId`, `userId`) VALUES (?, ?)', [lastId, sessionUserId]);

            let to = [];
            for (let member of members) {
                db.query('INSERT INTO `roomMembers`(`roomId`, `userId`) VALUES (?, ?)', [lastId, member]);

                let websocket = await mysql('SELECT websocket FROM `users` WHERE id=? AND websocket != ""', [member]);

                if (websocket && websocket[0]) {
                    to.push(websocket[0].websocket);
                } 
            }

            db.query('INSERT INTO `messages`(`fromId`, `toUserId`, `toRoomId`, `message`, `seen`, `forward`, `timestamp`) VALUES (?, -1, ?, "Welcome to our new room!", 1, -1, ?)', [sessionUserId, lastId, currentTimestamp], (error, results) => {
                this.output({
                    action: 'msg',
                    type: 'room',
                    chatId: lastId,
                    title: decodeURIComponent(title),
                    photo: decodeURIComponent(photo),
                    msgId: results.insertId,
                    msg: 'Welcome to our new room!',
                    from: {
                        first_name : this.req.session.user.first_name,
                        photo: this.req.session.user.photo
                    },
                    to: to
                });
            });
        });


    }
}


class User {
    constructor(id, first_name, last_name, username, photo, websocket = null) {
        this.id = id;
        this.first_name = first_name;
        this.last_name = last_name;
        this.username = username;
        this.photo = photo;
        this.websocket = websocket;
    }
}

const userJoiScheme = Joi.object({
    first_name: Joi.string()
        .min(3)
        .max(30),

    
    last_name: Joi.string()
        .min(3)
        .max(30),


    username: Joi.string()
        .alphanum()
        .min(3)
        .max(30),

    password: Joi.string()
        .regex(/^[a-zA-Z0-9]{3,30}$/),

    photo: Joi.string()
        .min(20)
});

const roomJoiScheme = Joi.object({
    title: Joi.string()
        .min(2)
        .required(),

    photo: Joi.string()
        .min(20)
        .required()
});

module.exports = router;