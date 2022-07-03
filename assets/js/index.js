const tonweb = new TonWeb(new TonWeb.HttpProvider('https://sandbox.tonhubapi.com/jsonRPC', {'apiKey': '85bd125f4999f3ffd2e4a6169f3365b107ee1d3112066301196e433509d0cf4c'}));
const BN = tonweb.utils.BN;
const toNano = TonWeb.utils.toNano;
const fromNano = TonWeb.utils.fromNano;

// Websocket connect
const socket = new WebSocket('wss://auction.ex-ton.org:8080/');
let wsToken, servicePublicKey, serviceWallet, serviceAddress;

// Load wallet from cache
let seed = window.localStorage.getItem('wallet_seed');
if (seed == null) {
    seed = tonweb.utils.newSeed();
    console.log(seed);
    window.localStorage.setItem('wallet_seed', tonweb.utils.bytesToBase64(seed));
} else seed = tonweb.utils.base64ToBytes(seed);
const keyPair = tonweb.utils.keyPairFromSeed(seed);
const wallet = tonweb.wallet.create({publicKey: keyPair.publicKey});
var walletAddress;

let walletBalance = '0';
let initStatus = 'wait';
let initIteration = 0;
let channelId, channelInitState, channelConfig,
    channel, channelAddress, fromWallet, channelState, serverSignature;

let bids = [];

function send_json(data) { socket.send(JSON.stringify({...data, token: wsToken})); }

// Interval update auction data
async function update() {
    tonweb.getBalance(walletAddress)
        .then(async function(balance) {
            walletBalance = balance;
            vWalletAddress.innerHTML = 'Your auction wallet (like B or C):<br><code>' + walletAddress.toString(true, true, true) + '</code><br>It\'s balance: <b>' + parseFloat(fromNano(balance)).toFixed(2) + ' TON</b> ' + ((initStatus === 'success') ? '🟩' : '🟥');

            if (wsToken && channel == null && initStatus !== 'topUp' && balance > 200000000) {
                channelInitState = {
                    balanceA: new BN(0),
                    balanceB: new BN(balance - 200000000),
                    seqnoA: new BN(0),
                    seqnoB: new BN(0)
                };
                channelConfig = {
                    'channelId': new BN(channelId),
                    'addressA': serviceAddress,
                    'addressB': walletAddress,
                    'initBalanceA': channelInitState.balanceA,
                    'initBalanceB': channelInitState.balanceB
                };
                channel = tonweb.payments.createChannel({
                    ...channelConfig,
                    isA: false,
                    myKeyPair: keyPair,
                    hisPublicKey: servicePublicKey
                });
                channelAddress = await channel.getAddress();

                fromWallet = channel.fromWallet({
                    'wallet': wallet,
                    'secretKey': keyPair.secretKey
                });
                channelState = {
                    balanceA: channelInitState.balanceA,
                    balanceB: channelInitState.balanceB,
                    seqnoA: channelInitState.seqnoA,
                    seqnoB: channelInitState.seqnoB
                }

                send_json({
                    type: 'initChannel',
                    initBalance: channelConfig.initBalanceB.toString(),
                    channelAddress: channelAddress.toString(true, true, true),
                })
            }
            else if (wsToken && channel && initStatus === 'open' && balance > 500000000) {
                await customBeforeUnload();
                window.location.reload();
            }
            else if (initStatus === "deploy") {
                let data = await tonweb.provider.getAddressInfo(channelAddress.toString(true, true, true));
                if (data.state && data.state === "uninitialized") {
                    console.log('Wait initialize');
                    if (initIteration > 10) {
                        console.log('Payment channel deploy was failed');
                        window.location.reload();
                    }

                    initIteration++;
                    setTimeout(update, 3000);
                } else {
                    let r = await fromWallet.topUp({
                        coinsA: channelInitState.balanceA,
                        coinsB: channelInitState.balanceB,
                    }).send(channelInitState.balanceB.add(toNano('0.05')));
                    console.log(r);
                    console.log(channelInitState.balanceB.add(toNano('0.05')).toString())
                    initStatus = 'topUp';
                    initIteration = 0;
                    setTimeout(update, 3000);
                }
            }
            else if (initStatus === 'topUp') {
                let data = await channel.getData();
                if (data.balanceB.toString() !== channelInitState.balanceB.toString()) {
                    console.log('Wait topUp');
                    if (initIteration > 15) {
                        console.log('TopUp failed, retry');
                        initStatus = 'deploy';
                    }
                    initIteration++;
                    setTimeout(update, 3000);
                } else {
                    await fromWallet.init(channelInitState).send(parseInt(toNano('0.05')));
                    initStatus = 'waitOpen';
                    initIteration = 0;
                    setTimeout(update, 3000);
                }
            }
            else if (initStatus === 'waitOpen') {
                let data = await channel.getData();
                if (data.state === 0) {
                    console.log('Wait open');
                    if (initIteration > 15) {
                        console.log('Open failed, retry');
                        initStatus = 'topUp';
                    }
                    initIteration++;
                    setTimeout(update, 3000);
                } else {
                    initStatus = 'success';
                    initIteration = 0;
                    console.log('Payment channel opened!');
                }
            }
        })
        .catch(error => {
            console.log(error);
            walletBalance = '0';
            vWalletAddress.innerHTML = 'Your auction wallet (like B or C):<br><code>' + walletAddress.toString(true, true, true) + '</code><br>It\'s balance: <b>0 TON</b>';
        });

}

async function placeBid() {
    if (initStatus !== 'success') {
        alert('Wait initialize');
        return;
    }



    let bid = toNano(bidAmountInput.value);
    if (bids.length) {
        if ((new BN(bids[bids.length - 1].amount)).gt(bid)) {
            alert('Bid amount must be greater than previous');
            return;
        }
    }

    channelState = {
        balanceA: channelState.balanceA.add(bid),
        balanceB: channelState.balanceB.sub(bid),
        seqnoA: channelState.seqnoA,
        seqnoB: channelState.seqnoB.add(new BN(1))
    };
    let signature = await channel.signState(channelState);
    send_json({
        type: 'placeBid',
        amount: bid.toString(),
        signature: tonweb.utils.bytesToBase64(signature)
    })
}

async function withdrawalAll() {

}

$(document).ready(async function() {
    placeBidButton.onclick = placeBid;
    withdrawalAllButton.onclick = withdrawalAll;
    console.log(tonweb);
    if (!(await wallet.methods.seqno().call())) {
        console.log('Deploy wallet..')
        await wallet.deploy(keyPair.secretKey).send();
    }
    console.log(wallet);
    walletAddress = await wallet.getAddress();
    console.log(walletAddress);
    console.log(walletAddress.toString(true, true, true));
    update();
    setInterval(() => {update();}, 10000);
});

socket.onmessage = async function(event) {
    console.log('Received: ' + event.data);
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }

    switch (data.type) {
        case 'auth': {
            wsToken = data.token;
            channelId = data.channelId;
            servicePublicKey = tonweb.utils.base64ToBytes(data.publicKey);
            serviceWallet = tonweb.wallet.create({publicKey: servicePublicKey});
            serviceAddress = await serviceWallet.getAddress();
            console.log('Service wallet is ' + serviceAddress.toString(true, true, true));
            return;
        }
        case 'initChannel': {
            await fromWallet.deploy().send(50000000);
            initStatus = 'deploy';
            setTimeout(update, 3000);
            console.log('Deployed');
            console.log(channel);
            console.log(channelInitState);
            console.log(fromWallet);
            return;
        }
        case 'unfreezeBid': {
            serverSignature = tonweb.utils.base64ToBytes(data.signature);
            channelState.seqnoA = channel.seqnoA.add(new BN(1));
            return;
        }
        case 'bidsList': {
            bids = data.bids;

            let bidsContent = '';
            if (bids.length) {
                bidsContent += '<li class="list-group-item active" aria-current="true" style="margin-left: 5rem;">' + bids[0].address + ' – ' + fromNano(bids[0].amount).toString() + '</li>';
                for (let i = 1; i < bids.length; i++) {
                    bidsContent += '<li class="list-group-item active" aria-current="true" style="margin-left: 5rem;">' + bids[i].address + ' – ' + fromNano(bids[i].amount).toString() + '</li>';
                }
            } else {
                bidsContent = 'There are no bids, be the first';
            }

            vBids.innerHTML = bidsContent;
            return;
        }
    }
}

socket.onopen = function() {
    console.log('Connected');
    send_json({
        type: 'auth',
        publicKey: tonweb.utils.bytesToBase64(keyPair.publicKey)
    });
}

socket.onclose = function() {
    console.log('Server not respond. Last signature: ' + (serverSignature === null ? 'null' : tonweb.utils.bytesToBase64(serverSignature)));
    console.log(channelState);
    console.log('Use this for uncooperative close payment channel')
}

async function customBeforeUnload() {
    if (initStatus === 'success') {
        channelState.seqnoA = channelState.seqnoA.add(new BN(1));
        channelState.seqnoB = channelState.seqnoB.add(new BN(1));
        console.log(channelState);
        console.log(channelState.balanceA.toString());
        console.log(channelState.balanceB.toString());
        const signatureClose = await channel.signClose(channelState);
        send_json({
            'type': 'close',
            'signature': tonweb.utils.bytesToBase64(signatureClose)
        });
    }
}