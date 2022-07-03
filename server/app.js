const ws = require('ws');
const TonWeb = require('tonweb');

const tonweb = new TonWeb(new TonWeb.HttpProvider('https://sandbox.tonhubapi.com/jsonRPC', {'apiKey': '85bd125f4999f3ffd2e4a6169f3365b107ee1d3112066301196e433509d0cf4c'}));
const BN = TonWeb.utils.BN;
const toNano = TonWeb.utils.toNano;
const fromNano = TonWeb.utils.fromNano;
const wss = new ws.Server({port: 8080});

// Wallet
console.log(process.env.SERVICE_SEED);
const keyPair = tonweb.utils.keyPairFromSeed(
    tonweb.utils.base64ToBytes(process.env.SERVICE_SEED)
);
const wallet = tonweb.wallet.create({publicKey: keyPair.publicKey});

// Global
let users = {};
let bids = [];

function send_json(ws, data) {
    try {
        ws.send(JSON.stringify(data));
    } catch (e) { console.log(e); }
}

async function broadcast_bids() {
    let content = [];
    for (let i = 0; i < bids.length; i++) {
        let hAddress = users[bids[i].token].walletAddress.toString(true, true, true);
        content.push({
            amount: bids[i].amount,
            address: hAddress.slice(0, 2) + '...' + hAddress.slice(-2)
        });
    }
    console.log(content);
    for (i in users) {
        send_json(users[i].ws, {
            'type': 'bidsList',
            'bids': content
        });
    }
}

async function unfreeze_bid() {
    if (bids.length > 0) {
        let last_bid = bids[bids.length - 1];
        let token = last_bid.token;
        let channelSumValue = users[token].channelInitState.balanceA.add(
            users[token].channelInitState.balanceB
        );
        users[token].channelState = {
            balanceA: new BN(0),
            balanceB: channelSumValue,
            seqnoA: users[token].channelState.seqnoA.add(new BN(1)),
            seqnoB: users[token].channelState.seqnoB
        }
        let signature = await users[token].channel.signState(users[token].channelState);
        send_json(users[token].ws, {
            type: 'unfreezeBid',
            signature: tonweb.utils.bytesToBase64(signature),
            newBalance: channelSumValue.toString(),
        });
    }
}

async function create_channel(data) {
    if (!(await wallet.methods.seqno().call())) {
        console.log('Deploy wallet..')
        await wallet.deploy(keyPair.secretKey).send();
    }

    walletAddressA = await wallet.getAddress();
    console.log('Our address: ' + walletAddressA.toString(true, true, true));
    walletAddressB = await users[data.token].wallet.getAddress();

    let channelInitState = {
        balanceA: new BN(0),
        balanceB: new BN(data.initBalance),
        seqnoA: new BN(0),
        seqnoB: new BN(0)
    }
    let channelConfig = {
        channelId: new BN(users[data.token].channelId),
        addressA: walletAddressA,
        addressB: walletAddressB,
        initBalanceA: channelInitState.balanceA,
        initBalanceB: channelInitState.balanceB
    };

    let channel = tonweb.payments.createChannel({
        ...channelConfig,
        isA: true,
        myKeyPair: keyPair,
        hisPublicKey: users[data.token].publicKey,
    });
    channelAddress = await channel.getAddress();
    console.log('Created channel: ' + channelAddress.toString(true, true, true));
    console.log('User channel: ' + data.channelAddress);
    users[data.token].channelInitState = channelInitState;
    users[data.token].channelState = channelInitState;
    users[data.token].channelConfig = channelConfig;
    users[data.token].channel = channel;
    users[data.token].seqnos = [channelInitState.seqnoA, channelInitState.seqnoB];
    if (data.channelAddress != channelAddress.toString(true, true, true)) {
        send_json(users[data.token].ws, {error: 'Channel address mismatch'})
        return;
    }

    users[data.token].fromWallet = channel.fromWallet({
        'wallet': wallet,
        'secretKey': keyPair.secretKey
    });

    send_json(users[data.token].ws, {
        type: 'initChannel',
        channelAddress: channelAddress.toString(true, true, true)
    });
}

wss.on('connection', (ws) => {
    ws.on('message', async function(message) {
        console.log('Received: ' + message);
        // console.log(users);
        let data;
        try { data = JSON.parse(message); } catch (e) { return; }
        if (data.type != 'auth' && !data.token) {
            send_json(ws, {error: 'Not authenticated'});
            return;
        }
        if (data.type == 'auth') {
            if (data.publicKey == null) { return; }

            token = tonweb.utils.bytesToBase64(tonweb.utils.newSeed())
            users[token] = {
                'ws': ws,
                'publicKey': tonweb.utils.base64ToBytes(data.publicKey),
                'channelId': Math.round(Math.random() * 9999999999999999)
            }
            users[token].wallet = tonweb.wallet.create({publicKey: users[token].publicKey});
            users[token].walletAddress = await users[token].wallet.getAddress();
            send_json(ws, {
                type: 'auth',
                token: token,
                publicKey: tonweb.utils.bytesToBase64(keyPair.publicKey),
                channelId: users[token].channelId
            });
            return;
        }
        if (!(data.token in users)) {
            send_json(ws, {error: 'Invalid token'});
            return;
        }

        switch (data.type) {
            case 'initChannel': {
                create_channel(data);
                return;
            }
            case 'topUp': { // Not used
                await users[data.token].fromWallet.topUp({
                    coinsA: users[data.token].channelInitState.balanceA,
                    coinsB: users[data.token].channelInitState.balanceB
                }).send(parseInt(toNano('0.05')));
                send_json(users[data.token].ws, {type: 'topUp'});
                console.log('Top upped');
                return;
            }
            case 'placeBid': {
                if (data.amount < bids[bids.length - 1].amount) {
                    send_json(ws, {error: 'Bid amount must be greater than previous'});
                    return;
                }
                unfreeze_bid();

                let channelSumValue = users[data.token].channelInitState.balanceA.add(
                    users[data.token].channelInitState.balanceB
                );
                users[data.token].channelState = {
                    balanceA: new BN(data.amount),
                    balanceB: new BN(channelSumValue.sub(new BN(data.amount))),
                    seqnoA: users[data.token].channelState.seqnoA,
                    seqnoB: users[data.token].channelState.seqnoB.add(new BN(1))
                }
                if (!(await users[data.token].channel.verifyState(users[data.token].channelState, tonweb.utils.base64ToBytes(data.signature)))) {
                    send_json(users[data.token].ws, {error: 'Invalid signature'});
                    return;
                }
                let signature = await users[data.token].channel.signState(users[data.token].channelState);
                bids.push({
                    token: data.token,
                    amount: data.amount
                })
                await broadcast_bids();
                return;
            }
            case 'close': {
                console.log(users[data.token].channelState);
                users[data.token].channelState.seqnoA = users[data.token].channelState.seqnoA.add(new BN(1));
                users[data.token].channelState.seqnoB = users[data.token].channelState.seqnoB.add(new BN(1));
                console.log(users[data.token].channelState);
                console.log(users[data.token].channelState.balanceA.toString());
                console.log(users[data.token].channelState.balanceB.toString());
                console.log('Verify signature');
                console.log(
                    (!(await users[data.token].channel.verifyState(users[data.token].channelState, tonweb.utils.base64ToBytes(data.signature))))
                );
                await users[data.token].fromWallet.close({
                    ...users[data.token].channelState,
                    hisSignature: tonweb.utils.base64ToBytes(data.signature)
                }).send(toNano('0.05'));
            }
            default: return;
        }
    });
});