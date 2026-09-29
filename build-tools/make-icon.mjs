// build-tools/icon.svg → resources/icon.png(512), resources/icon.ico(16~256). 아이콘을 바꾸면 node build-tools/make-icon.mjs
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'
import fs from 'fs'

const svg = fs.readFileSync(new URL('./icon.svg', import.meta.url))
const png = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
fs.writeFileSync(new URL('../resources/icon.png', import.meta.url), png(512))
fs.writeFileSync(new URL('../resources/icon.ico', import.meta.url), await pngToIco([16, 24, 32, 48, 64, 128, 256].map(png)))
console.log('아이콘을 만들었어요')
