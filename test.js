const program = require('commander')
const buildGroth16 = require('websnark/src/groth16')

const sleep = () => {
  return new Promise(resolve => setTimeout(resolve, 100))
}

async function main() {
  program
    .command('deposit <currency> <amount>')
    .description('Submit a deposit of specified currency and amount from default eth account and return the resulting note. The currency is one of (ETH|DAI|cDAI|USDC|cUSDC|USDT). The amount depends on currency, see config.js file or visit https://tornado.cash.')
    .action(async (currency, amount) => {
      console.log('currency, amount', currency, amount)
      let groth16 = await buildGroth16()
      console.log('groth16', groth16)
      groth16 = null
    })

  await program.parseAsync(process.argv)
}

main().then(process.exit(0))
