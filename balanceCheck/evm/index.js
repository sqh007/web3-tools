/**
 * 钱包余额批量查询脚本
 *
 * 📌 功能说明：
 * - 支持批量查询多个钱包地址的代币余额（原生币或 ERC20 代币）
 * - 支持设置查询重试次数和延迟时间，确保在网络异常下稳定运行
 * - 支持通过 `.env` 文件自定义配置，无需修改代码
 * - 查询结果会自动输出到 `./log/成功日志-xxx.txt` 和 `./log/失败日志-xxx.txt`
 *
 * ⚠️ 注意事项：
 * - 地址文件必须为纯文本，地址格式需以 0x 开头，每行一个地址
 * - 日志文件会覆盖同名旧文件，请注意备份
 */

const { ethers } = require('ethers');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const erc20ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
];
const envPath = path.resolve(__dirname, './.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const rpcUrl = envConfig.RPC_URL;
const tokenAddress = envConfig.TOKEN_ADDRESS;
const addressFile = envConfig.ADDRESS_FILE;
const MAX_RETRIES = parseInt(envConfig.MAX_RETRIES || '3');
const RETRY_DELAY_MS = parseInt(envConfig.RETRY_DELAY_MS || '500');
const dayjs = require('dayjs');
const formatted = dayjs().format('MMDDHHmmss');
const docDir = path.join(__dirname, './logs');
if (!fs.existsSync(docDir)) {
    fs.mkdirSync(docDir);
}

(async () => {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    const isNative = tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

    let decimals = 18;
    let symbol = '原生代币';

    let token = null;

    if (!isNative) {
        token = new ethers.Contract(tokenAddress, erc20ABI, provider);
        try {
            [decimals, symbol] = await Promise.all([
                token.decimals(),
                token.symbol()
            ]);
        } catch (err) {
            console.error('无法读取代币信息，请检查合约地址是否正确：', err.message);
            process.exit(1);
        }
    } else {
        try {
            const net = await provider.getNetwork();
            const chainToSymbol = {
                1: 'ETH',     // Ethereum Mainnet
                56: 'BNB',     // BNB Chain (BSC)
                137: 'MATIC',   // Polygon Mainnet
                10: 'ETH',     // Optimism
                42161: 'ETH',     // Arbitrum One
                43114: 'AVAX',    // Avalanche C-Chain
                250: 'FTM',     // Fantom Opera
                100: 'xDAI',    // Gnosis
                8453: 'ETH',     // Base Mainnet
                59144: 'ETH',     // Linea
                11155111: 'ETH'   // Sepolia Testnet
                // 可继续添加其他链
            };
            symbol = chainToSymbol[net.chainId] || '原生币';
        } catch (err) {
            console.warn('自动识别原生币失败，默认显示为“原生币”');
        }
    }
    let addressList;
    try {
        addressList = fs.readFileSync(path.join(__dirname, `./doc/${addressFile}`), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    } catch (error) {
        console.log(`你配置读取的${addressFile}文件 不存在，请检查后重新运行代码`);
        return
    }
    if (addressList.length == 0) {
        console.log(`你配置读取的${addressFile}文件没有内容，请检查后重新运行代码`);
        return;
    }
    fs.appendFileSync(path.join(__dirname, `./logs/查询成功-${addressFile}-${formatted}.txt`), `【成功】查询代币：${symbol}（${tokenAddress}）\n\n`);
    let failNum = 0;
    for (let i = 0; i < addressList.length; i++) {
        const address = addressList[i];
        try {
            const rawBalance = await withRetry(() =>
                isNative ? provider.getBalance(address) : token.balanceOf(address)
            );
            const balance = ethers.utils.formatUnits(rawBalance, decimals);
            console.log(`第${i}个钱包 ${address} 的 ${symbol} 余额为：${balance}`);
            fs.appendFileSync(path.join(__dirname, `./logs/查询成功-${addressFile}-${formatted}.txt`), `${address}:${balance}\n`);
        } catch (error) {
            failNum++;
            console.error(`第${i}个钱包 ${address} 查询失败：${error.message}`);
            fs.appendFileSync(path.join(__dirname, `./logs/查询失败-${addressFile}-${formatted}.txt`), `${address}\n`);
        }
    }
    console.log(`\n查询完成，结果已保存至：./logs/查询成功-${addressFile}-${formatted}`);

})()

// 简单延迟函数
const delay = ms => new Promise(res => setTimeout(res, ms));

// 封装带重试的查询逻辑
async function withRetry(fn, retries = MAX_RETRIES, delayMs = RETRY_DELAY_MS) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (i < retries - 1) {
                await delay(delayMs);
            }
        }
    }
    throw lastError;
}