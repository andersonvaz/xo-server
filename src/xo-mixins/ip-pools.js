import { NoSuchObject } from '../api-errors'
import {
  forEach,
  generateUnsecureToken,
  isEmpty,
  streamToArray,
  throwFn
} from '../utils'

// ===================================================================

class NoSuchIpPool extends NoSuchObject {
  constructor (id) {
    super(id, 'ip pool')
  }
}

const normalize = ({
  addresses,
  id = throwFn('id is a required field'),
  name = '',
  networks
}) => ({
  addresses,
  id,
  name,
  networks
})

// ===================================================================

export default class IpPools {
  constructor (xo) {
    this._store = null
    this._xo = xo

    xo.on('start', async () => {
      this._store = await xo.getStore('ipPools')
    })
  }

  async createIpPool ({ addresses, name, networks }) {
    const id = await this._generateId()

    await this._save({
      addresses,
      id,
      name,
      networks
    })

    return id
  }

  async deleteIpPool (id) {
    const store = this._store

    if (await store.has(id)) {
      return store.del(id)
    }

    throw new NoSuchIpPool(id)
  }

  getAllIpPools () {
    return streamToArray(this._store.createValueStream(), {
      mapper: normalize
    })
  }

  getIpPool (id) {
    return this._store.get(id).then(normalize, error => {
      throw error.notFound ? new NoSuchIpPool(id) : error
    })
  }

  async updateIpPool (id, {
    addresses,
    name,
    networks
  }) {
    const ipPool = await this.getIpPool(id)

    name != null && (ipPool.name = name)
    if (addresses) {
      const addresses_ = ipPool.addresses || {}
      forEach(addresses, (props, address) => {
        if (props === null) {
          delete addresses[address]
        } else {
          addresses[address] = props
        }
      })
      if (isEmpty(addresses_)) {
        delete ipPool.addresses
      } else {
        ipPool.addresses = addresses
      }
    }
    if (networks) {
      const networks_ = ipPool.networks || {}
      forEach(networks, (props, network) => {
        if (props === null) {
          delete networks[network]
        } else {
          networks[network] = props
        }
      })
      if (isEmpty(networks_)) {
        delete ipPool.networks
      } else {
        ipPool.networks = networks
      }
    }

    await this._save(ipPool)
  }

  async _generateId () {
    let id
    do {
      id = generateUnsecureToken(8)
    } while (await this._store.has(id))
    return id
  }

  _save (ipPool) {
    ipPool = normalize(ipPool)
    return this._store.put(ipPool.id, ipPool)
  }
}
