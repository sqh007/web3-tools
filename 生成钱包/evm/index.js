/**
 * EVM 钱包批量生成脚本
 *
 * 功能说明：
 * - 批量生成指定数量的 EVM 钱包（如以太坊地址）
 * - 可选择使用单一助记词派生多个钱包（HD 钱包）
 * - 或使用多个独立助记词分别生成钱包
 * - 输出为 Excel 文件（包含地址、私钥、助记词）
 *
 * 输出路径：
 * - ./doc/MMDD-HHmmss-数量-wallets.xlsx
 *
 * 注意事项：
 * - 助记词与私钥极度敏感，请妥善保存输出文件
 */


const path = require('path');
const fs = require('fs');
const bip39 = require('bip39');
const { ethers } = require("ethers");
const dayjs = require('dayjs');
const ExcelJS = require('exceljs');
const dotenv = require('dotenv');
const envPath = path.resolve(__dirname, './.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
// 配置
const num = parseInt(envConfig.NUM || '10');
const isUsingSingleMnemonic = envConfig.USE_SINGLE_MNEMONIC === 'false';


(async () => {
    const formatted = dayjs().format('MMDD-HHmmss');

    const docDir = path.join(__dirname, './doc');
    if (!fs.existsSync(docDir)) {
        fs.mkdirSync(docDir);
    }
    // 创建一个新的工作簿
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Wallets');

    // 添加表头
    worksheet.columns = [
        { header: 'Address', key: 'address', width: 42 },
        { header: 'Private Key', key: 'privateKey', width: 66 },
        { header: 'Mnemonic', key: 'mnemonic', width: 60 },
    ];

    let mnemonic = bip39.generateMnemonic();
    let derivationPath = "m/44'/60'/0'/0/0";
    for (let i = 0; i < num; i++) {
        if (!isUsingSingleMnemonic) {
            mnemonic = bip39.generateMnemonic();
        } else {
            derivationPath = `m/44'/60'/0'/0/${i}`
        }
        const hdNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
        const wallet = new ethers.Wallet(hdNode.derivePath(derivationPath).privateKey);

        // 添加一行数据
        worksheet.addRow({
            address: wallet.address,
            privateKey: wallet.privateKey,
            mnemonic: mnemonic,
        });

    }
    // 写入 Excel 文件
    const filePath = path.join(docDir, `${formatted}-${num}-wallets.xlsx`);
    await workbook.xlsx.writeFile(filePath);


    console.log(`${num}个钱包已生成成功！保存至：${filePath}`);
})()