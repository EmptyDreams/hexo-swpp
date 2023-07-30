// noinspection JSUnresolvedVariable

"use strict"

const config = hexo.config
const enable = (config.swpp ?? hexo.theme.config.swpp)?.enable

if (enable) {
    const configLoader = require('./lib/configLoader')
    const rules = configLoader.load(hexo)
    // 排序
    require('./lib/sort.js')(rules.config)
    // 生成 update.json
    require('./lib/jsonBuilder.js')(hexo, config, rules)
    // 生成 sw.js
    require('./lib/swBuilder.js')(hexo, config, rules)
}