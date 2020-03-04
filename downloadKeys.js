const axios = require('axios')
const path = require('path')
const fs = require('fs')
const files = ['withdraw.json', 'withdraw_proving_key.bin', 'Verifier.sol', 'withdraw_verification_key.json']
const circuitsPath = 'build/circuits'
const contractsPath = 'build/contracts'

async function downloadFile({ url, path }) {
  const writer = fs.createWriteStream(path)

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  })

  response.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

async function main() {
  const release = await axios.get('https://api.github.com/repos/tornadocash/tornado-core/releases/latest')
  const { assets } = release.data
  if (!fs.existsSync(circuitsPath)){
    fs.mkdirSync(circuitsPath, { recursive: true })
    fs.mkdirSync(contractsPath, { recursive: true })
  }
  for(let asset of assets) {
    if (files.includes(asset.name)) {
      console.log(`Downloading ${asset.name} ...`)
      await downloadFile({
        url: asset.browser_download_url,
        path: path.resolve(__dirname, circuitsPath, asset.name)
      })
    }
  }
}

main()
