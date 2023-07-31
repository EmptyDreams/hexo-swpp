// noinspection JSUnresolvedVariable

"use strict"

const config = hexo.config
const enable = (config.swpp ?? hexo.theme.config.swpp)?.enable

if (enable) {
    const configLoader = require('./lib/configLoader')
    const rules = configLoader.load(hexo)
    const ejectValues = calcEjectValues(hexo, rules)
    // 排序
    require('./lib/sort.js')(rules.config)
    // 生成 update.json
    require('./lib/jsonBuilder.js')(hexo, config, rules, ejectValues.obj)
    // 生成 sw.js
    require('./lib/swBuilder.js')(hexo, config, rules, ejectValues.str)
}

/**
 * 计算导出的键值表
 * @param hexo
 * @param rules
 * @return {?{str: string, obj: *}}
 */
function calcEjectValues(hexo, rules) {
    if (!('ejectValues' in rules)) return null
    const obj = rules.ejectValues(hexo, rules)
    const nodeObj = {}
    let result = ''
    for (let key in obj) {
        if (!key.match(/^[A-Za-z0-9]+$/)) {
            logger.error(`[SWPP EjectValues] 变量名 [${key}] 仅允许包含英文字母和阿拉伯数字！`)
            throw "变量名异常：" + key
        }
        const data = obj[key]
        const type = typeof data.value
        nodeObj[key] = data.value
        switch (type) {
            case 'undefined': break
            case 'boolean': case 'number': case 'string': case 'bigint':
                result += `    ${data.prefix} eject${key[0].toUpperCase()}${key.substring(1)} = ${getSource(data.value)}`
                break
            default:
                logger.error(`[SWPP EjectValues] 不支持导出 ${type} 类型的数据。`)
                throw `不支持的键值：key=${key}, value type=${type}`
        }
    }
    return {
        obj: nodeObj, str: result
    }
}

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