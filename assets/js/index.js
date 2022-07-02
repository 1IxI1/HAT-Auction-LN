const tonweb = new TonWeb(new TonWeb.HttpProvider('https://sandbox.tonhubapi.com/jsonRPC', {'apiKey': '85bd125f4999f3ffd2e4a6169f3365b107ee1d3112066301196e433509d0cf4c'}));
const toNano = TonWeb.utils.toNano;
const fromNano = TonWeb.utils.fromNano;

async function update(walletAddress) {
    let balance = await tonweb.getBalance(walletAddress);
    vWalletAddress.innerHTML = 'Your service wallet is ' + walletAddress.toString(true, true, true) + ' <b>[' + fromNano(balance) + ' TON]</b>';
}

$(document).ready(async function() {
    console.log(tonweb);
    let seed = window.localStorage.getItem('wallet_seed');
    if (seed == null) {
        seed = tonweb.utils.newSeed();
        console.log(seed);
        window.localStorage.setItem('wallet_seed', tonweb.utils.bytesToBase64(seed));
    } else seed = tonweb.utils.base64ToBytes(seed);

    const keyPair = tonweb.utils.keyPairFromSeed(seed);
    const wallet = tonweb.wallet.create({publicKey: keyPair.publicKey});
    console.log(wallet);
    const walletAddress = await wallet.getAddress();
    update(walletAddress);
    setInterval(() => {update(walletAddress);}, 10000);
});