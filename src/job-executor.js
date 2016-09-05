import assign from 'lodash/assign'
import Bluebird from 'bluebird'
import filter from 'lodash/filter'
import map from 'lodash/map'
import mapValues from 'lodash/mapValues'
import { BaseError } from 'make-error'

import match from './match'
import { crossProduct } from './math'
import {
  serializeError,
  thunkToArray
} from './utils'

export class JobExecutorError extends BaseError {}
export class UnsupportedJobType extends JobExecutorError {
  constructor (job) {
    super('Unknown job type: ' + job.type)
  }
}
export class UnsupportedVectorType extends JobExecutorError {
  constructor (vector) {
    super('Unknown vector type: ' + vector.type)
  }
}

// ===================================================================

const paramsVectorActionsMap = {
  extractProperties ({ mapping, value }) {
    return mapValues(mapping, key => value[key])
  },
  crossProduct ({ items }) {
    return thunkToArray(crossProduct(
      map(items, value => resolveParamsVector.call(this, value))
    ))
  },
  fetchObjects ({ pattern }) {
    return filter(this.xo.getObjects(), object => match(pattern, object))
  },
  map ({ collection, iteratee, paramName = 'value' }) {
    return map(resolveParamsVector.call(this, collection), value => {
      return resolveParamsVector.call(this, {
        ...iteratee,
        [paramName]: value
      })
    })
  },
  set: ({ values }) => values
}

export function resolveParamsVector (paramsVector) {
  const visitor = paramsVectorActionsMap[paramsVector.type]
  if (!visitor) {
    throw new Error(`Unsupported function '${paramsVector.type}'.`)
  }

  return visitor.call(this, paramsVector)
}

// ===================================================================

export default class JobExecutor {
  constructor (xo) {
    this.xo = xo
    this._extractValueCb = {
      'set': items => items.values
    }

    // The logger is not available until Xo has started.
    xo.on('start', () => xo.getLogger('jobs').then(logger => {
      this._logger = logger
    }))
  }

  async exec (job) {
    const runJobId = this._logger.notice(`Starting execution of ${job.id}.`, {
      event: 'job.start',
      userId: job.userId,
      jobId: job.id,
      key: job.key
    })

    try {
      if (job.type === 'call') {
        const execStatus = await this._execCall(job, runJobId)

        this.xo.emit('job:terminated', execStatus)
      } else {
        throw new UnsupportedJobType(job)
      }

      this._logger.notice(`Execution terminated for ${job.id}.`, {
        event: 'job.end',
        runJobId
      })
    } catch (error) {
      this._logger.error(`The execution of ${job.id} has failed.`, {
        event: 'job.end',
        runJobId,
        error: serializeError(error)
      })

      throw error
    }
  }

  async _execCall (job, runJobId) {
    const { paramsVector } = job
    const paramsFlatVector = paramsVector
      ? resolveParamsVector.call(this, paramsVector)
      : [{}] // One call with no parameters

    const connection = this.xo.createUserConnection()

    connection.set('user_id', job.userId)

    const execStatus = {
      runJobId,
      start: Date.now(),
      calls: {}
    }

    await Bluebird.map(paramsFlatVector, params => {
      const runCallId = this._logger.notice(`Starting ${job.method} call. (${job.id})`, {
        event: 'jobCall.start',
        runJobId,
        method: job.method,
        params
      })

      const call = execStatus.calls[runCallId] = {
        method: job.method,
        params,
        start: Date.now()
      }

      return this.xo.callApiMethod(connection, job.method, assign({}, params)).then(
        value => {
          this._logger.notice(`Call ${job.method} (${runCallId}) is a success. (${job.id})`, {
            event: 'jobCall.end',
            runJobId,
            runCallId,
            returnedValue: value
          })

          call.returnedValue = value
          call.end = Date.now()
        },
        reason => {
          this._logger.notice(`Call ${job.method} (${runCallId}) has failed. (${job.id})`, {
            event: 'jobCall.end',
            runJobId,
            runCallId,
            error: serializeError(reason)
          })

          call.error = reason
          call.end = Date.now()
        }
      )
    }, {
      concurrency: 2
    })

    connection.close()
    execStatus.end = Date.now()

    return execStatus
  }
}
