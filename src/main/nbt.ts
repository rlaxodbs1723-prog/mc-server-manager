// 마인크래프트 NBT 형식 읽기/쓰기 (level.dat 등). gzip으로 압축된 빅엔디언 이진 형식이다.
// 월드 파일을 망가뜨리지 않도록 이름·문자열은 받은 바이트 그대로(Buffer) 들고 있다가 그대로 다시 쓴다.
import zlib from 'zlib'

export const TAG = {
  End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6,
  ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12
} as const

export type Tag =
  | { type: 1 | 2 | 3; value: number } // Byte, Short, Int
  | { type: 4; value: bigint } // Long
  | { type: 5 | 6; value: number } // Float, Double
  | { type: 7; value: Buffer } // ByteArray
  | { type: 8; value: Buffer } // String (자바 변형 UTF-8 바이트 그대로)
  | { type: 9; value: { elemType: number; items: Tag[] } } // List
  | { type: 10; value: [Buffer, Tag][] } // Compound (순서 유지)
  | { type: 11; value: Int32Array | number[] } // IntArray
  | { type: 12; value: bigint[] } // LongArray

class Reader {
  pos = 0
  constructor(private buf: Buffer) {}
  u8 = () => this.buf.readUInt8(this.pos++)
  i8 = () => this.buf.readInt8(this.pos++)
  i16 = () => ((this.pos += 2), this.buf.readInt16BE(this.pos - 2))
  u16 = () => ((this.pos += 2), this.buf.readUInt16BE(this.pos - 2))
  i32 = () => ((this.pos += 4), this.buf.readInt32BE(this.pos - 4))
  i64 = () => ((this.pos += 8), this.buf.readBigInt64BE(this.pos - 8))
  f32 = () => ((this.pos += 4), this.buf.readFloatBE(this.pos - 4))
  f64 = () => ((this.pos += 8), this.buf.readDoubleBE(this.pos - 8))
  bytes = (n: number) => ((this.pos += n), Buffer.from(this.buf.subarray(this.pos - n, this.pos)))
  str = () => this.bytes(this.u16())

  payload(type: number): Tag {
    switch (type) {
      case 1: return { type, value: this.i8() }
      case 2: return { type, value: this.i16() }
      case 3: return { type, value: this.i32() }
      case 4: return { type, value: this.i64() }
      case 5: return { type, value: this.f32() }
      case 6: return { type, value: this.f64() }
      case 7: return { type, value: this.bytes(this.i32()) }
      case 8: return { type, value: this.str() }
      case 9: {
        const elemType = this.u8()
        const n = this.i32()
        const items: Tag[] = []
        for (let i = 0; i < n; i++) items.push(this.payload(elemType))
        return { type, value: { elemType, items } }
      }
      case 10: {
        const entries: [Buffer, Tag][] = []
        for (;;) {
          const t = this.u8()
          if (t === 0) break
          const name = this.str()
          entries.push([name, this.payload(t)])
        }
        return { type, value: entries }
      }
      case 11: {
        const n = this.i32()
        const arr: number[] = []
        for (let i = 0; i < n; i++) arr.push(this.i32())
        return { type, value: arr }
      }
      case 12: {
        const n = this.i32()
        const arr: bigint[] = []
        for (let i = 0; i < n; i++) arr.push(this.i64())
        return { type, value: arr }
      }
      default:
        throw new Error(`알 수 없는 NBT 태그 종류: ${type}`)
    }
  }
}

class Writer {
  private chunks: Buffer[] = []
  private push(b: Buffer): void {
    this.chunks.push(b)
  }
  private num(size: number, fn: (b: Buffer) => void): void {
    const b = Buffer.alloc(size)
    fn(b)
    this.push(b)
  }
  u8 = (v: number) => this.num(1, (b) => b.writeUInt8(v))
  i32 = (v: number) => this.num(4, (b) => b.writeInt32BE(v))
  str = (s: Buffer) => (this.num(2, (b) => b.writeUInt16BE(s.length)), this.push(s))

  payload(t: Tag): void {
    switch (t.type) {
      case 1: return this.num(1, (b) => b.writeInt8(t.value))
      case 2: return this.num(2, (b) => b.writeInt16BE(t.value))
      case 3: return this.i32(t.value)
      case 4: return this.num(8, (b) => b.writeBigInt64BE(t.value))
      case 5: return this.num(4, (b) => b.writeFloatBE(t.value))
      case 6: return this.num(8, (b) => b.writeDoubleBE(t.value))
      case 7: return (this.i32(t.value.length), this.push(t.value))
      case 8: return this.str(t.value)
      case 9:
        this.u8(t.value.elemType)
        this.i32(t.value.items.length)
        for (const item of t.value.items) this.payload(item)
        return
      case 10:
        for (const [name, child] of t.value) {
          this.u8(child.type)
          this.str(name)
          this.payload(child)
        }
        return this.u8(0)
      case 11:
        this.i32(t.value.length)
        for (const v of t.value) this.i32(v)
        return
      case 12:
        this.i32(t.value.length)
        for (const v of t.value) this.num(8, (b) => b.writeBigInt64BE(v))
        return
    }
  }
  result = () => Buffer.concat(this.chunks)
}

export interface NbtFile {
  rootName: Buffer
  root: Tag & { type: 10 }
  gzipped: boolean
}

export function parseNbt(file: Buffer): NbtFile {
  const gzipped = file[0] === 0x1f && file[1] === 0x8b
  const r = new Reader(gzipped ? zlib.gunzipSync(file) : file)
  const type = r.u8()
  if (type !== TAG.Compound) throw new Error('NBT 파일 형식이 아니에요.')
  const rootName = r.str()
  return { rootName, root: r.payload(type) as Tag & { type: 10 }, gzipped }
}

export function serializeNbt({ rootName, root, gzipped }: NbtFile): Buffer {
  const w = new Writer()
  w.u8(TAG.Compound)
  w.str(rootName)
  w.payload(root)
  const raw = w.result()
  return gzipped ? zlib.gzipSync(raw) : raw
}

// 컴파운드 안에서 이름으로 찾기
export function child(compound: Tag & { type: 10 }, name: string): Tag | undefined {
  const key = Buffer.from(name, 'utf8')
  return compound.value.find(([n]) => n.equals(key))?.[1]
}

// 컴파운드의 값을 바꾸거나, 없으면 끝에 추가한다
export function setChild(compound: Tag & { type: 10 }, name: string, tag: Tag): void {
  const key = Buffer.from(name, 'utf8')
  const entry = compound.value.find(([n]) => n.equals(key))
  if (entry) entry[1] = tag
  else compound.value.push([key, tag])
}
