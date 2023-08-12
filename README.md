这是 `swpp-backends` 的 hexo 端实现，绝大多数功能由 [swpp-backends](https://github.com/EmptyDreams/swpp-backends) 提供。

## 安装

使用时需要同时安装 `hexo-swpp` 和 `swpp-backends`：

```bash
npm install hexo-swpp swpp-backends
```

当 `swpp-backends` 存在版本更新时，可以直接更新 `swpp-backends` 版本，不需要更新 `hexo-swpp` 的版本。（不过 `hexo-swpp` 有更新的话最好也跟进一下。）

注意：更新 `swpp-backends` 版本时需要注意其版本是否与 `hexo-swpp` 匹配，版本匹配列表如下：

| hexo-swpp 版本 | swpp-backends 版本 |
|:------------:|:----------------:|
|     ~3.0     |      ^1.0.0      |
|     ~3.1     |      ^1.1.0      |
|     ~3.2     |      ^2.0.0      |

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