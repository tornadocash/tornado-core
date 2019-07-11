
class MerkleTree {

  constructor(prefix, storage, hasher, n_levels, zero_value, defaultElements) {
    this.prefix = prefix;
    this.storage = storage;
    this.hasher = hasher;
    this.n_levels = n_levels;
    this.zero_values = [];

    let current_zero_value = zero_value;
    this.zero_values.push(current_zero_value);
    for (let i = 0; i < n_levels; i++) {
      current_zero_value = this.hasher.hash(i, current_zero_value, current_zero_value);
      this.zero_values.push(
        current_zero_value.toString(),
      );
    }
    if (defaultElements) {
        let level = 0
        defaultElements.forEach((element, i) => {
            this.storage.put(MerkleTree.element_to_key(prefix, element), i.toString())
            this.storage.put(MerkleTree.index_to_key(prefix, level, i), element)
        })
        level++
        let numberOfElementInRow = Math.ceil(defaultElements.length / 2) 
        for (level; level <= this.n_levels; level++) {
            for(let i = 0; i < numberOfElementInRow; i++) {
                const leftKey = MerkleTree.index_to_key(prefix, level - 1, 2 * i)
                const rightKey = MerkleTree.index_to_key(prefix, level - 1, 2 * i + 1)

                const left = this.storage.get(leftKey)
                const right = this.storage.get_or_element(rightKey, this.zero_values[level - 1])

                const subRoot = this.hasher.hash(null, left, right);
                this.storage.put(MerkleTree.index_to_key(prefix, level, i), subRoot)
            }
            numberOfElementInRow = Math.max(Math.ceil(numberOfElementInRow / 2), 1)
        }
    }
  }

  static index_to_key(prefix, level, index) {
    const key = `${prefix}_tree_${level}_${index}`;
    return key;
  }

  static element_to_key(prefix, element) {
    const key = `${prefix}_element_${element}`;
    return key;
  }



  static update_log_to_key(prefix) {
    return `${prefix}_update_log_index`;
  }

  static update_log_element_to_key(prefix, update_log_index) {
    return `${prefix}_update_log_element_${update_log_index}`;
  }

  async update_log(index, old_element, new_element, update_log_index, should_put_element_update) {
    let ops = [];

    const update_log_key = MerkleTree.update_log_to_key(this.prefix);
    ops.push({
      type: 'put',
      key: update_log_key,
      value: update_log_index.toString(),
    });

    if (should_put_element_update) {
      const update_log_element_key = MerkleTree.update_log_element_to_key(this.prefix, update_log_index);
      ops.push({
        type: 'put',
        key: update_log_element_key,
        value: JSON.stringify({
          index,
          old_element,
          new_element,
        })
      });
    }
    await this.storage.put_batch(ops);
  }

  async root() {
    let root = await this.storage.get_or_element(
      MerkleTree.index_to_key(this.prefix, this.n_levels, 0),
      this.zero_values[this.n_levels],
    );

    return root;
  }

  async element_index(element) {
    const element_key = MerkleTree.element_to_key(this.prefix, element);
    const index = await this.storage.get_or_element(element_key, -1);
    return index;
  }

  async path(index) {
    class PathTraverser {
      constructor(prefix, storage, zero_values) {
        this.prefix = prefix;
        this.storage = storage;
        this.zero_values = zero_values;
        this.path_elements = [];
        this.path_index = [];
      }

      async handle_index(level, element_index, sibling_index) {
        const sibling = await this.storage.get_or_element(
          MerkleTree.index_to_key(this.prefix, level, sibling_index),
          this.zero_values[level],
        );
        this.path_elements.push(sibling);
        this.path_index.push(element_index % 2);
      }
    }
    let traverser = new PathTraverser(this.prefix, this.storage, this.zero_values);
    const root = await this.storage.get_or_element(
      MerkleTree.index_to_key(this.prefix, this.n_levels, 0),
      this.zero_values[this.n_levels],
    );

    const element = await this.storage.get_or_element(
      MerkleTree.index_to_key(this.prefix, 0, index),
      this.zero_values[0],
    );

    await this.traverse(index, traverser);
    return {
      root,
      path_elements: traverser.path_elements,
      path_index: traverser.path_index,
      element
    };
  }

  async update(index, element, update_log_index) {
    try {
      //console.log(`updating ${index}, ${element}`);
      class UpdateTraverser {
        constructor(prefix, storage, hasher, element, zero_values) {
          this.prefix = prefix;
          this.current_element = element;
          this.zero_values = zero_values;
          this.storage = storage;
          this.hasher = hasher;
          this.key_values_to_put = [];
        }

        async handle_index(level, element_index, sibling_index) {
          if (level == 0) {
            this.original_element = await this.storage.get_or_element(
              MerkleTree.index_to_key(this.prefix, level, element_index),
              this.zero_values[level],
            );
            this.key_values_to_put.push({
              key: MerkleTree.element_to_key(this.prefix, element),
              value: index.toString(),
            });

          }
          const sibling = await this.storage.get_or_element(
            MerkleTree.index_to_key(this.prefix, level, sibling_index),
            this.zero_values[level],
          );
          let left, right;
          if (element_index % 2 == 0) {
            left = this.current_element;
            right = sibling;
          } else {
            left = sibling;
            right = this.current_element;
          }

          this.key_values_to_put.push({
            key: MerkleTree.index_to_key(this.prefix, level, element_index),
            value: this.current_element,
          });
          //console.log(`left: ${left}, right: ${right}`);
          this.current_element = this.hasher.hash(level, left, right);
          //console.log(`current_element: ${this.current_element}`);
        }
      }
      let traverser = new UpdateTraverser(
        this.prefix,
        this.storage,
        this.hasher,
        element,
        this.zero_values
      );

      await this.traverse(index, traverser);
      //console.log(`traverser.current_element: ${traverser.current_element}`);
      traverser.key_values_to_put.push({
        key: MerkleTree.index_to_key(this.prefix, this.n_levels, 0),
        value: traverser.current_element,
      });

      if (update_log_index == undefined) {
        const update_log_key = MerkleTree.update_log_to_key(this.prefix);
        let update_log_index_from_db = await this.storage.get_or_element(update_log_key, -1);
        update_log_index = parseInt(update_log_index_from_db) + 1;
        await this.update_log(index, traverser.original_element, element, update_log_index, true);
      } else {
        await this.update_log(index, traverser.original_element, element, update_log_index, false);
      }

      await this.storage.del(MerkleTree.element_to_key(this.prefix, traverser.original_element));
      //traverser.key_values_to_put.forEach((e) => console.log(`key_values: ${JSON.stringify(e)}`));
      await this.storage.put_batch(traverser.key_values_to_put);

      const root = await this.root();
      //console.log(`updated root ${root}`);
    } catch(e) {
        console.error(e)
    }
  }

  async traverse(index, handler) {
    let current_index = index;
    for (let i = 0; i < this.n_levels; i++) {
        let sibling_index = current_index;
        if (current_index % 2 == 0) {
          sibling_index += 1;
        } else {
          sibling_index -= 1;
        }
        await handler.handle_index(i, current_index, sibling_index);
        current_index = Math.floor(current_index / 2);
      }
  }

  async rollback(updates) {
    try {
      const update_log_key = MerkleTree.update_log_to_key(this.prefix);
      const update_log_index = await this.storage.get(update_log_key);
      for (let i = 0; i < updates; i++) {
        const update_log_element_key = MerkleTree.update_log_element_to_key(this.prefix, update_log_index - i);
        const update_element_log = JSON.parse(await this.storage.get(update_log_element_key));

        await this.update(update_element_log.index, update_element_log.old_element, update_log_index - i - 1);
      }
    } catch (e) {
        console.error(e)
    }
  }

  async rollback_to_root(root) {
    // await this.lock.acquireAsync();
    try {
      const update_log_key = MerkleTree.update_log_to_key(this.prefix);
      let update_log_index = await this.storage.get(update_log_key);
      while (update_log_index >= 0) {
        update_log_index -= 1;
        const update_log_element_key = MerkleTree.update_log_element_to_key(this.prefix, update_log_index - i);
        const update_element_log = JSON.parse(await this.storage.get(update_log_element_key));

        await this.update(update_element_log.index, update_element_log.old_element, update_log_index);
        const current_root = await this.root();
        if (current_root == root) {
          break;
        }
      }
      if (await this.root() != root) {
        throw new Error(`could not rollback to root ${root}`);
      }
    } catch (e) {
        console.log(e)
    }

  }
}

module.exports = MerkleTree;