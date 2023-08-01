// noinspection JSUnresolvedVariable

"use strict"

const config = hexo.config
const enable = (config.swpp ?? hexo.theme.config.swpp)?.enable

if (enable) {
    try {
        const configLoader = require('./lib/configLoader')
        const rules = configLoader.load(hexo)
        const ejectValues = calcEjectValues(hexo, rules)
        // 排序
        require('./lib/sort')(rules.config)
        // 生成 update.json
        require('./lib/jsonBuilder')(hexo, config, rules, ejectValues?.obj)
        // 生成 sw.js
        require('./lib/swBuilder')(hexo, config, rules, ejectValues?.str)
    } catch (e) {
        const logger = require('hexo-log')()
        logger.error('[SWPP Index] 加载过程中遇到了错误：')
        process.exit(114514)
    }
}

/**
 * 计算导出的键值表
 * @param hexo
 * @param rules
 * @return {?{str: string, obj: *}}
 */
function calcEjectValues(hexo, rules) {
    if (!('ejectValues' in rules)) return null
    const { getSource } = require('./lib/utils')
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