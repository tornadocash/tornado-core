const jsStorage = require('./Storage')
const hasherImpl = require('./MiMC')
const { bigInt } = require('snarkjs')

class MerkleTree {

  constructor(n_levels, defaultElements, prefix, storage, hasher) {
    this.prefix = prefix
    this.storage = storage || new jsStorage()
    this.hasher = hasher || new hasherImpl()
    this.n_levels = n_levels
    this.zero_values = []
    this.totalElements = 0

    let current_zero_value = bigInt('5702960885942360421128284892092891246826997279710054143430547229469817701242')
    this.zero_values.push(current_zero_value)
    for (let i = 0; i < n_levels; i++) {
      current_zero_value = this.hasher.hash(i, current_zero_value, current_zero_value)
      this.zero_values.push(
        current_zero_value.toString(),
      )
    }
    if (defaultElements) {
      let level = 0
      this.totalElements = defaultElements.length
      defaultElements.forEach((element, i) => {
        this.storage.put(MerkleTree.index_to_key(prefix, level, i), element)
      })
      level++
      let numberOfElementsInLevel = Math.ceil(defaultElements.length / 2)
      for (level; level <= this.n_levels; level++) {
        for(let i = 0; i < numberOfElementsInLevel; i++) {
          const leftKey = MerkleTree.index_to_key(prefix, level - 1, 2 * i)
          const rightKey = MerkleTree.index_to_key(prefix, level - 1, 2 * i + 1)

          const left = this.storage.get(leftKey)
          const right = this.storage.get_or_element(rightKey, this.zero_values[level - 1])

          const subRoot = this.hasher.hash(null, left, right)
          this.storage.put(MerkleTree.index_to_key(prefix, level, i), subRoot)
        }
        numberOfElementsInLevel = Math.ceil(numberOfElementsInLevel / 2)
      }
    }
  }

  static index_to_key(prefix, level, index) {
    const key = `${prefix}_tree_${level}_${index}`
    return key
  }

  async root() {
    let root = await this.storage.get_or_element(
      MerkleTree.index_to_key(this.prefix, this.n_levels, 0),
      this.zero_values[this.n_levels],
    )

    return root
  }

  async path(index) {
    class PathTraverser {
      constructor(prefix, storage, zero_values) {
        this.prefix = prefix
        this.storage = storage
        this.zero_values = zero_values
        this.path_elements = []
        this.path_index = []
      }

      async handle_index(level, element_index, sibling_index) {
        const sibling = await this.storage.get_or_element(
          MerkleTree.index_to_key(this.prefix, level, sibling_index),
          this.zero_values[level],
        )
        this.path_elements.push(sibling)
        this.path_index.push(element_index % 2)
      }
    }
    let traverser = new PathTraverser(this.prefix, this.storage, this.zero_values)
    const root = await this.storage.get_or_element(
      MerkleTree.index_to_key(this.prefix, this.n_levels, 0),
      this.zero_values[this.n_levels],
    )

    const element = await this.storage.get_or_element(
      MerkleTree.index_to_key(this.prefix, 0, index),
      this.zero_values[0],
    )

    await this.traverse(index, traverser)
    return {
      root,
      path_elements: traverser.path_elements,
      path_index: traverser.path_index,
      element
    }
  }

  async update(index, element, insert = false) {
    if (!insert && index >= this.totalElements) {
      throw Error('Use insert method for new elements.')
    } else if(insert && index < this.totalElements) {
      throw Error('Use update method for existing elements.')
    }
    try {
      class UpdateTraverser {
        constructor(prefix, storage, hasher, element, zero_values) {
          this.prefix = prefix
          this.current_element = element
          this.zero_values = zero_values
          this.storage = storage
          this.hasher = hasher
          this.key_values_to_put = []
        }

        async handle_index(level, element_index, sibling_index) {
          if (level == 0) {
            this.original_element = await this.storage.get_or_element(
              MerkleTree.index_to_key(this.prefix, level, element_index),
              this.zero_values[level],
            )
          }
          const sibling = await this.storage.get_or_element(
            MerkleTree.index_to_key(this.prefix, level, sibling_index),
            this.zero_values[level],
          )
          let left, right
          if (element_index % 2 == 0) {
            left = this.current_element
            right = sibling
          } else {
            left = sibling
            right = this.current_element
          }

          this.key_values_to_put.push({
            key: MerkleTree.index_to_key(this.prefix, level, element_index),
            value: this.current_element,
          })
          this.current_element = this.hasher.hash(level, left, right)
        }
      }
      let traverser = new UpdateTraverser(
        this.prefix,
        this.storage,
        this.hasher,
        element,
        this.zero_values
      )

      await this.traverse(index, traverser)
      traverser.key_values_to_put.push({
        key: MerkleTree.index_to_key(this.prefix, this.n_levels, 0),
        value: traverser.current_element,
      })

      await this.storage.put_batch(traverser.key_values_to_put)
    } catch(e) {
      console.error(e)
    }
  }

  async insert(element) {
    const index = this.totalElements
    await this.update(index, element, true)
    this.totalElements++
  }

  async traverse(index, handler) {
    let current_index = index
    for (let i = 0; i < this.n_levels; i++) {
      let sibling_index = current_index
      if (current_index % 2 == 0) {
        sibling_index += 1
      } else {
        sibling_index -= 1
      }
      await handler.handle_index(i, current_index, sibling_index)
      current_index = Math.floor(current_index / 2)
    }
  }

  getIndexByElement(element) {
    for(let i = this.totalElements - 1; i >= 0; i--) {
      const elementFromTree = this.storage.get(MerkleTree.index_to_key(this.prefix, 0, i))
      if (elementFromTree === element) {
        return i
      }
    }
    return false
  }
}

module.exports = MerkleTree
