// The installed native provider alone decodes credentials. Never copy or log them.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { LocalCredentialProvider } = await import(pathToFileURL(join(process.env.DSH_EVAL_RUNTIME, '@deepseek-ai/dsh-credentials-local/lib/index.js')))
export default class ReadOnlyEvaluationCredentials extends LocalCredentialProvider {
  async describe(ref) { return { ...await super.describe(ref), writable:false } }
  async describeRecord(key) { return { ...await super.describeRecord(key), writable:false } }
  async set() { throw new Error('Evaluation credentials are read only') }
  async unset() { throw new Error('Evaluation credentials are read only') }
  async deleteRecord() { throw new Error('Evaluation credentials are read only') }
  async migrateFlatDocument() { throw new Error('Evaluation cannot migrate credentials') }
  async modifyRecord(key, mutate) {
    return this.enqueue(async () => {
      const current = await super.readRecord(key)
      const next = await mutate(current)
      if (next === undefined) return current
      this.records.set(key,next)
      this.notifyRecordUpdated(key)
      return next
    })
  }
}
