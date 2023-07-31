const logger = require('hexo-log')()

/**
 * 获取任意对象（symbol 类型除外）的源码
 * @param any {any} 对象
 * @param separator {string} 分隔符
 * @param whiteList {string[]?} 白名单
 * @param mapper {?function(string):string} 输出转换函数
 * @return {string}
 */
function getSource(any, separator = '\n', whiteList = null, mapper = null) {
    let result
    switch (typeof any) {
        case 'undefined':
            result = `undefined${separator}`
            break
        case 'object': {
            result = whiteList ? '' : '{\n'
            result += Object.getOwnPropertyNames(any)
                .filter(key => !whiteList || whiteList.includes(key))
                .map(key => {
                    const value = any[key]
                    let nextMapper = null
                    if (whiteList && ['cacheList', 'modifyRequest'].includes(key)) {
                        nextMapper = str => str.replace(/\(\s*(.*?)\s*,\s*\$eject\s*\)/g, "$1")
                            .replaceAll(/\$eject\.(\w+)/g, (_, match) => `eject${match[0].toUpperCase()}${match.substring(1)}`)
                    }
                    return whiteList ? `const ${key} = ${getSource(value, '', null, nextMapper)}` : `${key}: ${getSource(value, '')}`
                }).join(whiteList ? '\n' : ',\n')
            result += (whiteList ? '' : '\n}') + separator
            break
        }
        case 'string':
            result = `'${any}'${separator}`
            break
        case 'bigint':
            result = `${any.toString()}n${separator}`
            break
        default:
            result = any.toString() + separator
            break
        case 'symbol':
            logger.error("[SWPP ServiceWorkerBuilder] 不支持写入 symbol 类型，请从 sw-rules.js 中移除相关内容！")
            throw '不支持写入 symbol 类型'
    }
    if (mapper) result = mapper(result)
    return result
}

module.exports = { getSource }