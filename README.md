这是 `swpp-backends` 的 hexo 端实现，绝大多数功能由 [swpp-backends](https://github.com/EmptyDreams/swpp-backends) 提供。

## 安装

使用时需要同时安装 `hexo-swpp` 和 `swpp-backends`：

```bash
npm install hexo-swpp swpp-backends
```

当 `swpp-backends` 存在版本更新时，可以直接更新 `swpp-backends` 版本，不需要更新 `hexo-swpp` 的版本。（不过 `hexo-swpp` 有更新的话最好也跟进一下。）

## 使用

在 hexo 或主题的配置文件中添加如下内容即可启用插件：

```yml
swpp:
  enable: true
```

插件的具体配置见 [Swpp Backends 官方文档 | 山岳库博](https://kmar.top/posts/b70ec88f/)。

### sort

`hexo-swpp` 在规则文件中添加了一个配置项——`sort`，用法如下：

```javascript
module.exports.config = {
    sort: {
        posts: 'title',
        pages: 'title',
        tags: 'name'
    }
}
```

该配置项是为了对 hexo 中的一些变量进行排序，避免每次生成 HTML 时由于这些变量的顺序变动导致生成结果不完全相同。上方代码给出的值为插件的缺省值，用户设置该项不会直接覆盖这些值，只有用户也声明 `posts`、`pages` 或 `tags` 时才会覆盖对应的值。

其中 key 值为要排序的变量的名称，value 为变量排序时的依据，填 `false` 表示禁用该项排序，填 `true` 表示以 value 本身为键进行排序，填字符串表示以 `value[tag]` 为键进行排序。

### update

`hexo-swpp` 允许用户通过 `update` 项向插件手动提交更新，按照如下格式填写：

```javascript
module.exports.update = {
    flag: true,
    force: false,
    /** @type string[] */
    refresh: [],
    /** @type ChangeExpression[] */
    change: []
}
```

+ `flag` 是更新标记，只有当本次更新标记与上次值不相同时 `update` 的内容才会生效，所以修改 `update` 后没有必要手动清空 `update` 的内容。
+ `force` 为强制更新标记，当设置为 `true` 时会清除前端所有缓存。
+ `refresh` 为 URL 刷新列表，填写想要刷新缓存的 URL
+ `change` 为刷新列表，填写要提交的缓存刷新表达式，表达式写法见 `swpp-backends` 中的 `ChangeExpression` 类型

### extraListenedUrls

`hexo-swpp` 支持用户通过 `extraListenedUrls` 项向插件添加需要监听的 URL，按照如下格式填写：

```javascript
module.exports.extraListenedUrls = []
```

`extraListenedUrls` 的值不一定要是数组，只要是包含 `forEach` 函数的对象就可以，元素类型必须是 `string`。