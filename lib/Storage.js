

class JsStorage {
  constructor() {
    this.db = {};
  }

  get(key) {
    return this.db[key];
  }

  get_or_element(key, defaultElement) {
    const element = this.db[key];
    if (element === undefined) {
        return defaultElement;
    } else {
        return element
    }
  }

  put(key, value) {
    this.db[key] = value;
  }

  del(key) {
    delete this.db[key];
  }

  put_batch(key_values) {
    key_values.forEach(element => {
        this.db[element.key] = element.value;
    });
  }
}

module.exports = JsStorage;