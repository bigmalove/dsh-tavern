// 客户端在模块求值期就会定义 React 类组件（顶栏错误边界等），
// 所以加载 client.js 时 require 不能返回空对象：Component / PureComponent
// 必须是一个可继承的类，其余宿主模块在加载期只被解构，给个惰性函数即可。
export const clientModuleStub = new Proxy({}, {
  get: (target, key) => key === 'Component' || key === 'PureComponent'
    ? class {}
    : function () { return null }
})
