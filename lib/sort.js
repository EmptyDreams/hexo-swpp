const nodePath = require("path")

/** 对 Hexo 内的属性进行排序 */
module.exports = config => {
    const compare = (a, b) => {
        const result = a.length === b.length ? a < b : a.length < b.length
        return result ? -1 : 1
    }
    const sort = (obj, value) => {
        if (!obj) return
        const target = obj.data ?? obj
        if (!target.sort) return
        if (value !== false) target.sort((a, b) => compare(a[value], b[value]))
        else target.sort(compare)
    }
    const list = {
        posts: 'title',
        pages: 'title',
        tags: 'name',
        categories: 'name'
    }
    Object.assign(list, config.sort)
    const Locals = require(`${nodePath.resolve('./', 'node_modules/hexo/lib/hexo/locals')}`).prototype
    const get = Locals.get
    Locals.get = function(name) {
        const result = get.call(this, name)
        if (name in list) sort(result, list[name])
        if ('forEach' in result) {
            result.forEach(it => {
                for (let tag in list)
                    sort(it[tag], list[tag])
            })
        }
        return result
    }
}