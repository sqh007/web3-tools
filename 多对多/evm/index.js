// =======================================
// 多对多 EVM 转账工具 - 单文件版
// 支持原生币与任意 ERC20 代币
// 支持金额模式配置、Gas 配置、延迟发送、结果日志记录
// =======================================

// ==== 依赖模块 ====
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ethers } = require('ethers');
const dotenv = require('dotenv');
const dayjs = require('dayjs');

// ==== 加载配置 ====
const envPath = path.resolve(__dirname, './.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

// ==== 解析配置 ====
const config = {
  rpcUrl: envConfig.RPC_URL,
  tokenAddress: envConfig.TOKEN_ADDRESS,

  // 金额配置模式：fixed 固定，range 区间，all 全部，percent 百分比，remain 保留固定余额
  transferMode: envConfig.TRANSFER_MODE,
  fixedAmount: parseFloat(envConfig.TRANSFER_FIXED || '0'),
  minAmount: parseFloat(envConfig.TRANSFER_MIN || '0'),
  maxAmount: parseFloat(envConfig.TRANSFER_MAX || '0'),
  percent: parseFloat(envConfig.TRANSFER_PERCENT || '0'),
  remainAmount: parseFloat(envConfig.TRANSFER_REMAIN || '0'),

  // Gas 设置
  gasPriceMode: envConfig.GAS_PRICE_MODE || 'auto', // auto or fixed
  gasPriceGwei: parseFloat(envConfig.GAS_PRICE_GWEI || '5'),

  gasLimitMode: envConfig.GAS_LIMIT_MODE || 'auto',
  gasLimit: parseInt(envConfig.GAS_LIMIT || '21000'),

  // 延迟设置
  delayMin: parseInt(envConfig.DELAY_MIN || '1'),
  delayMax: parseInt(envConfig.DELAY_MAX || '3'),

  addressFile: envConfig.ADDRESS_FILE || 'address.txt',
};
const formatted = dayjs().format('MMDDHHmmss');

// ==== 工具函数 ====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay() {
  const delay = Math.floor(Math.random() * (config.delayMax - config.delayMin + 1) + config.delayMin);
  return sleep(delay * 1000);
}

function randomAmount(min, max, decimals = 6) {
  const factor = Math.pow(10, decimals);
  const randInt = Math.floor(Math.random() * (max * factor - min * factor) + min * factor);
  return (randInt / factor).toFixed(decimals);
}

function formatAmount(amount, decimals = 18) {
  return ethers.utils.parseUnits(amount.toString(), decimals);
}

function toReadable(balance, decimals = 18) {
  return parseFloat(ethers.utils.formatUnits(balance, decimals)).toFixed(6);
}

// ==== 预览转账信息 ====
async function previewTransfers(provider) {
  let raw;
  try {
    raw = fs.readFileSync(path.resolve(__dirname, 'doc', config.addressFile), 'utf-8');
  } catch (error) {
    console.log(`你配置读取的${config.addressFile}文件 不存在，请检查后重新运行代码`);
    process.exit(0);
  }
  const lines = raw.split(/\r?\n/).filter(l => l.trim());

  const tokenIsNative = config.tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

  const result = [];
  const skipped = [];
  const previewLines = ['序号 | 发送地址(余额) => 接收地址 | 代币 | 预计发送金额'];

  for (let i = 0; i < lines.length; i++) {
    const [privateKey, to] = lines[i].split(':');
    const wallet = new ethers.Wallet(privateKey.trim(), provider);
    const from = await wallet.getAddress();

    // 获取余额
    let balanceRaw;
    try {
      balanceRaw = tokenIsNative
        ? await provider.getBalance(from)
        : await new ethers.Contract(config.tokenAddress, ['function balanceOf(address) view returns (uint256)'], provider).balanceOf(from);
    } catch (e) {
      console.error(`❌ 查询余额失败: ${from}`);
      continue;
    }

    const balance = toReadable(balanceRaw, config.decimals);
    const b = parseFloat(balance);
    let amount = 0;
    const randomDecimals = parseInt(envConfig.TRANSFER_RANDOM_DECIMALS || '6');

    // 计算发送金额
    switch (config.transferMode) {
      case 'fixed': amount = config.fixedAmount; break;
      case 'range': amount = parseFloat(randomAmount(config.minAmount, config.maxAmount, randomDecimals)); break;
      case 'all': amount = b; break;
      case 'percent': amount = b * config.percent; break;
      case 'remain': amount = Math.max(b - config.remainAmount, 0); break;
    }

    if (b <= 0) {
      skipped.push(`${i + 1} | ${from}(${balance}) => ${to.trim()} | ${config.symbol} |  ${amount.toFixed(6)} | 余额为0，跳过`);
      continue;
    }

    if (amount <= 0 || amount > b) {
      skipped.push(`${i + 1} | ${from}(${balance}) => ${to.trim()} | ${config.symbol} |  ${amount.toFixed(6)} | 余额不足，无法发送`);
      continue;
    }

    previewLines.push(`${i + 1} | ${from}(${balance}) => ${to.trim()} | ${config.symbol} | ${amount.toFixed(6)}`);
    result.push({ privateKey, from, to: to.trim(), amount });
  }
  const logDir = path.resolve(__dirname, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
  const previewPath = path.join(logDir, `预交易信息-${config.addressFile}-${formatted}.txt`);

  fs.writeFileSync(previewPath, previewLines.join('\n'), 'utf-8');
  console.log(`✅ 转账预览已生成：${previewPath}`);
  return {
    list: result,
    skipped
  };

}

// ==== 执行转账 ====
async function executeTransfers(provider, list) {
  const tokenIsNative = config.tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

  const logDir = path.resolve(__dirname, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
  const successLog = path.join(logDir, `交易成功-${config.addressFile}-${formatted}.txt`);
  const failLog = path.join(logDir, `交易失败-${config.addressFile}-${formatted}.txt`);

  for (const { privateKey, from, to, amount } of list) {
    const wallet = new ethers.Wallet(privateKey, provider);
    const value = formatAmount(amount, config.decimals);
    const overrides = {};

    if (config.gasPriceMode === 'fixed') {
      overrides.gasPrice = ethers.utils.parseUnits(config.gasPriceGwei.toString(), 'gwei');
    }

    if (config.gasLimitMode === 'fixed') {
      overrides.gasLimit = config.gasLimit;
    }

    try {
      let tx;
      if (tokenIsNative) {
        // 原生币转账
        tx = await withRetry(() =>
          wallet.sendTransaction({ to, value, ...overrides })
        );
      } else {
        // ERC20代币转账
        const token = new ethers.Contract(config.tokenAddress, ['function transfer(address,uint256) returns (bool)'], wallet);
        tx = await withRetry(() =>
          token.transfer(to, value, overrides)
        );
      }
      console.log(`✅ 成功 | ${from} => ${to} | ${amount} | Hash: ${tx.hash}`);
      fs.appendFileSync(successLog, `${from} => ${to} | ${amount} | ${tx.hash}\n`);
    } catch (err) {
      console.error(`❌ 失败 | ${from} => ${to} | ${amount} | ${err.message}`);
      fs.appendFileSync(failLog, `${from} => ${to} | ${amount} | ${err.message}\n`);
    }

    await randomDelay(); // 每次发送后随机等待
  }
}
async function withRetry(fn, maxRetries = 3, delay = 1000) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await fn(); // 尝试执行原始函数
    } catch (error) {
      attempt++;
      const isFinalAttempt = attempt > maxRetries;

      // 可选：你也可以只对某些错误类型重试
      const retriable = error?.code === 'SERVER_ERROR' || error?.code === -32603 || error?.message?.includes('no response');

      if (!retriable || isFinalAttempt) {
        console.error(`❌ 第 ${attempt} 次尝试失败：`, error.message || error);
        throw error;
      }

      const backoff = delay * Math.pow(2, attempt); // 指数退避
      console.warn(`⚠️ 第 ${attempt} 次失败，${backoff}ms 后重试...`);
      await new Promise(res => setTimeout(res, backoff));
    }
  }
}

async function getTokenMetadata(provider, tokenAddress) {
  const network = await provider.getNetwork();
  if (tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    config.decimals = 18;
    config.symbol = 'Native';
    config.chainName = network.name;
    return;
  }
  const abi = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
  ];
  const token = new ethers.Contract(tokenAddress, abi, provider);
  const [symbol, decimals] = await Promise.all([
    token.symbol(),
    token.decimals()
  ]);
  config.decimals = decimals;
  config.symbol = symbol;
  config.chainName = network.name;
}
// ==== 主流程入口 ====
(async () => {
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);

  // 获取代币符号（如果不是原生币）
  await getTokenMetadata(provider, config.tokenAddress);


  const { list: transferList, skipped } = await previewTransfers(provider);

  if (transferList.length === 0) {
    const logDir = path.resolve(__dirname, 'logs');
    const skippedPath = path.join(logDir, `无效交易-${config.addressFile}-${formatted}.txt`);
    fs.writeFileSync(skippedPath, skipped.join('\n'), 'utf-8');
    console.log(`❗没有可执行的转账任务。已跳过 ${skipped.length} 个地址`);
    console.log(`📄 跳过原因详情见：${skippedPath}`);
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('请确认预览文件无误，输入yes开始执行转账：', async answer => {
    rl.close();
    if (answer.trim().toLowerCase() === 'yes') {
      await executeTransfers(provider, transferList);
      console.log('✅ 所有任务执行完成。');
    } else {
      console.log('⚠️ 输入有误 已取消执行转账。');
    }
  });
})();
