# 介绍

&emsp;&emsp;该插件用于在 hexo 中自动构建可用的 ServiceWorker，插件内自带了一个缺省的 sw.js，也支持使用自定义的 sw。

# 配置说明

&emsp;&emsp;`onError`及`onSuccess`为必填项（无缺省设置），其余为可选项，可选项的缺省设置为下方列出的设置。

```yaml
swpp:
  # 是否使用自定义的 sw，为 true 时不自动生成 sw.js，但是仍然会插入注册 sw 的代码
  # 注：不支持自定义 sw.js 的路径及文件名，sw.js 必须放置在 source_dir 中
  customJS: false
  # 注册 sw 发生错误时触发的 js 代码，如果包含多个指令需使用花括号（{}）包裹
  onError: "document.addEventListener('DOMContentLoaded', () => kms.pushInfo('当前浏览器不支持SW，建议更换浏览器以获取最佳体验~'))"
  # 注册 sw 成功后触发的 js 代码，如果包含多个指令需使用花括号（{}）包裹
  onSuccess: "location.reload()"
  # 最大 HTML 数量，超过这个数量后会直接清除所有 HTML 缓存
  maxHtml: 15
  # update.json 的最大字符数量
  # 超过后会移除旧的版本号，直到满足要求，如果只有全部清空才能满足就会直接刷新所有缓存
  charLimit: 1024
  # 文件缓存匹配采取精确模式
  # 关闭时更新缓存时仅匹配文件名称，如 https://kmar.top/simple/a/index.html 仅匹配 /a/index.html
  # 开启后更新缓存时将会匹配完整名称，如 https://kmar.top/simple/a/index.html 将匹配 /simple/a/index.html
  # 两种方式各有优劣，开启后会增加 update.json 的空间占用，但会提升精确度
  # 如果网站内没有多级目录结构，就可以放心大胆的关闭了
  # key 值为文件拓展名，default 用于指代所有未列出的拓展名以及没有拓展名的文件
  precisionMode:
    default: false
  # 是否合并指定项目
  # 例如当 tags 为 true 时（假设标签目录为 https://kmar.top/tags/...）
  # 如果标签页存在更新，则直接匹配 https://kmar.top/tags/ 目录下的所有文件
  # 推荐将此项开启
  merge:
    tags: true
    archives: true
    categories: true
    index: true
  # 忽略哪些文件，正则表达式，不写两边的斜杠，不区分大小写
  # 注：匹配的时候不附带域名，只有 pathname
  exclude:
    # 这里写正则表达式，格式如下：
    - sw\.js
```