// React 核心依赖
import React, { Children, useContext, useEffect, useMemo, useRef, useState } from 'react';
// 类名合并工具
import classNames from 'classnames';
// 布局副作用钩子，用于避免低性能的多重点击问题
import useLayoutEffect from 'rc-util/lib/hooks/useLayoutEffect';
// 对象属性过滤工具
import omit from 'rc-util/lib/omit';
// 引用合并工具
import { useComposeRef } from 'rc-util/lib/ref';

// 开发环境警告工具
import { devUseWarning } from '../_util/warning';
// 点击波纹效果组件
import Wave from '../_util/wave';
// 配置上下文，用于获取全局配置
import { ConfigContext, useComponentConfig } from '../config-provider/context';
// 禁用状态上下文
import DisabledContext from '../config-provider/DisabledContext';
// 尺寸钩子，用于获取组件尺寸
import useSize from '../config-provider/hooks/useSize';
// 尺寸类型定义
import type { SizeType } from '../config-provider/SizeContext';
// 紧凑模式上下文，用于 Space.Compact 场景
import { useCompactItemContext } from '../space/Compact';
// 按钮组组件和尺寸上下文
import Group, { GroupSizeContext } from './button-group';
// 按钮相关的类型定义
import type {
  ButtonColorType,
  ButtonHTMLType,
  ButtonShape,
  ButtonType,
  ButtonVariantType,
} from './buttonHelpers';
// 按钮辅助函数：判断两个中文字符、判断无边框变体、子元素间距处理
import { isTwoCNChar, isUnBorderedButtonVariant, spaceChildren } from './buttonHelpers';
// 默认加载图标组件
import DefaultLoadingIcon from './DefaultLoadingIcon';
// 图标包装器组件
import IconWrapper from './IconWrapper';
// 样式生成钩子
import useStyle from './style';
// 紧凑模式样式组件
import Compact from './style/compact';

/**
 * 遗留按钮类型
 * 兼容旧版本 API，包含原有的 ButtonType 和 'danger' 类型
 */
export type LegacyButtonType = ButtonType | 'danger';

/**
 * 按钮基础属性接口
 * 定义了按钮组件的所有基础配置项
 */
export interface BaseButtonProps {
  /** 按钮类型（兼容旧版 API） */
  type?: ButtonType;
  /** 按钮颜色 */
  color?: ButtonColorType;
  /** 按钮变体（实心、描边、虚线、文本、链接） */
  variant?: ButtonVariantType;
  /** 图标节点 */
  icon?: React.ReactNode;
  /** 图标位置：开始或结束 */
  iconPosition?: 'start' | 'end';
  /** 按钮形状：默认、圆形、圆角 */
  shape?: ButtonShape;
  /** 按钮尺寸：大、中、小 */
  size?: SizeType;
  /** 是否禁用 */
  disabled?: boolean;
  /** 加载状态：布尔值或包含延迟和自定义图标的配置对象 */
  loading?: boolean | { delay?: number; icon?: React.ReactNode };
  /** 样式类名前缀 */
  prefixCls?: string;
  /** 自定义类名 */
  className?: string;
  /** 根节点类名 */
  rootClassName?: string;
  /** 幽灵按钮（背景透明） */
  ghost?: boolean;
  /** 危险按钮 */
  danger?: boolean;
  /** 块级按钮（宽度占满父容器） */
  block?: boolean;
  /** 子元素 */
  children?: React.ReactNode;
  /** 自定义 data-* 属性 */
  [key: `data-${string}`]: string;
  /** 子元素类名配置 */
  classNames?: { icon: string };
  /** 子元素样式配置 */
  styles?: { icon: React.CSSProperties };
}

/**
 * 合并的 HTML 属性类型
 * 合并了通用 HTML 元素、按钮元素和锚点元素的属性，并排除了 'type' 和 'color'（避免与按钮属性冲突）
 */
type MergedHTMLAttributes = Omit<
  React.HTMLAttributes<HTMLElement> &
    React.ButtonHTMLAttributes<HTMLElement> &
    React.AnchorHTMLAttributes<HTMLElement>,
  'type' | 'color'
>;

/**
 * 按钮组件属性接口
 * 继承基础属性和 HTML 属性，并添加按钮特有的属性
 */
export interface ButtonProps extends BaseButtonProps, MergedHTMLAttributes {
  /** 链接地址（当提供时，按钮会渲染为 <a> 标签） */
  href?: string;
  /** HTML 按钮类型（button、submit、reset） */
  htmlType?: ButtonHTMLType;
  /** 是否自动在两个中文字符之间插入空格 */
  autoInsertSpace?: boolean;
}

/**
 * 加载配置类型
 */
type LoadingConfigType = {
  /** 是否处于加载状态 */
  loading: boolean;
  /** 延迟时间（毫秒） */
  delay: number;
};

/**
 * 获取加载配置
 * 将 loading 属性转换为标准化的加载配置对象
 * @param loading - 加载状态：布尔值或配置对象
 * @returns 标准化的加载配置
 */
function getLoadingConfig(loading: BaseButtonProps['loading']): LoadingConfigType {
  // 如果 loading 是对象类型，解析延迟时间
  if (typeof loading === 'object' && loading) {
    let delay = loading?.delay;
    // 验证延迟时间是否为有效数字，否则默认为 0
    delay = !Number.isNaN(delay) && typeof delay === 'number' ? delay : 0;
    return {
      // 延迟时间小于等于 0 时立即显示加载状态
      loading: delay <= 0,
      delay,
    };
  }

  // loading 为布尔值时，直接返回
  return {
    loading: !!loading,
    delay: 0,
  };
}

/**
 * 颜色和变体配对类型
 * 元组类型，第一个元素为颜色，第二个元素为变体
 */
type ColorVariantPairType = [color?: ButtonColorType, variant?: ButtonVariantType];

/**
 * 按钮类型映射表
 * 将旧版 type 属性映射到新的 color 和 variant 组合
 * 用于向后兼容
 */
const ButtonTypeMap: Partial<Record<ButtonType, ColorVariantPairType>> = {
  default: ['default', 'outlined'],
  primary: ['primary', 'solid'],
  dashed: ['default', 'dashed'],
  // `link` 不是真正的颜色，但需要兼容它
  link: ['link' as any, 'link'],
  text: ['default', 'text'],
};

/**
 * 内部复合按钮组件
 * 使用 forwardRef 支持 ref 转发，可以渲染为 <button> 或 <a> 标签
 */
const InternalCompoundedButton = React.forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonProps
>((props, ref) => {
  // ========================= Props =========================
  // 解构并设置默认值
  const {
    loading = false,
    prefixCls: customizePrefixCls,
    color,
    variant,
    type,
    danger = false,
    shape: customizeShape,
    size: customizeSize,
    styles,
    disabled: customDisabled,
    className,
    rootClassName,
    children,
    icon,
    iconPosition = 'start',
    ghost = false,
    block = false,
    // React 不识别 DOM 元素上的 `htmlType` 属性，这里从 rest 中提取出来
    htmlType = 'button',
    classNames: customClassNames,
    style: customStyle = {},
    autoInsertSpace,
    autoFocus,
    ...rest
  } = props;

  // ========================= Type =========================
  // 兼容原始 `type` 行为
  // https://github.com/ant-design/ant-design/issues/47605
  const mergedType = type || 'default';
  const { button } = React.useContext(ConfigContext);

  // 合并形状配置：优先使用自定义形状，其次使用上下文配置，最后使用默认值
  const shape = customizeShape || button?.shape || 'default';

  // ========================= Color & Variant =========================
  /**
   * 合并颜色和变体配置
   * 优先级：本地配置 > 糖语法（type/danger）> 上下文配置 > 默认值
   */
  const [mergedColor, mergedVariant] = useMemo<ColorVariantPairType>(() => {
    // >>>>> 本地配置优先
    // 如果同时提供了 color 和 variant，直接使用
    if (color && variant) {
      return [color, variant];
    }

    // >>>>> 糖语法（向后兼容）
    // 如果使用了 type 或 danger 属性，从映射表中获取对应的颜色和变体
    if (type || danger) {
      const colorVariantPair = ButtonTypeMap[mergedType] || [];
      // 如果设置了 danger，覆盖颜色为 danger
      if (danger) {
        return ['danger', colorVariantPair[1]];
      }
      return colorVariantPair;
    }

    // >>>>> 上下文回退
    // 如果上下文中有配置，使用上下文配置
    if (button?.color && button?.variant) {
      return [button.color, button.variant];
    }

    // 默认值：默认颜色 + 描边变体
    return ['default', 'outlined'];
  }, [color, variant, type, danger, button?.color, button?.variant, mergedType]);

  // 判断是否为危险按钮，用于生成类名
  const isDanger = mergedColor === 'danger';
  const mergedColorText = isDanger ? 'dangerous' : mergedColor;

  // ========================= Context =========================
  // 从组件配置上下文获取配置
  const {
    getPrefixCls,
    direction,
    autoInsertSpace: contextAutoInsertSpace,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles,
  } = useComponentConfig('button');

  // 合并自动插入空格配置：优先使用本地配置，其次使用上下文配置，最后默认为 true
  const mergedInsertSpace = autoInsertSpace ?? contextAutoInsertSpace ?? true;

  // 获取样式类名前缀
  const prefixCls = getPrefixCls('btn', customizePrefixCls);

  // 生成样式相关变量
  const [wrapCSSVar, hashId, cssVarCls] = useStyle(prefixCls);

  // ========================= Disabled =========================
  // 从禁用上下文获取禁用状态
  const disabled = useContext(DisabledContext);
  // 合并禁用状态：优先使用自定义禁用状态，其次使用上下文禁用状态
  const mergedDisabled = customDisabled ?? disabled;

  // ========================= Size =========================
  // 从按钮组上下文获取尺寸（如果按钮在按钮组中）
  const groupSize = useContext(GroupSizeContext);

  // ========================= Loading =========================
  // 计算加载配置（包含延迟时间）
  const loadingOrDelay = useMemo<LoadingConfigType>(() => getLoadingConfig(loading), [loading]);
  // 内部加载状态（考虑延迟）
  const [innerLoading, setLoading] = useState<boolean>(loadingOrDelay.loading);

  // ========================= Two CN Char =========================
  // 是否包含两个中文字符（用于自动插入空格）
  const [hasTwoCNChar, setHasTwoCNChar] = useState<boolean>(false);

  // ========================= Ref =========================
  // 按钮引用
  const buttonRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  // 合并外部 ref 和内部 ref
  const mergedRef = useComposeRef(ref, buttonRef);

  // ========================= Insert Space =========================
  // 判断是否需要插入空格：只有一个子元素、没有图标、且不是无边框变体
  const needInserted =
    Children.count(children) === 1 && !icon && !isUnBorderedButtonVariant(mergedVariant);

  // ========================= Mount ==========================
  /**
   * 记录挂载状态
   * 用于避免首次挂载时显示加载动画
   */
  const isMountRef = useRef(true);
  React.useEffect(() => {
    // 组件挂载后，标记为非首次挂载
    isMountRef.current = false;
    return () => {
      // 组件卸载时，重置为首次挂载状态
      isMountRef.current = true;
    };
  }, []);

  // ========================= Effect =========================
  /**
   * 加载状态处理
   * 使用 useLayoutEffect 避免低性能的多重点击问题
   * https://github.com/ant-design/ant-design/issues/51325
   */
  useLayoutEffect(() => {
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    // 如果设置了延迟时间，延迟显示加载状态
    if (loadingOrDelay.delay > 0) {
      delayTimer = setTimeout(() => {
        delayTimer = null;
        setLoading(true);
      }, loadingOrDelay.delay);
    } else {
      // 无延迟，立即设置加载状态
      setLoading(loadingOrDelay.loading);
    }

    // 清理函数：清除定时器
    function cleanupTimer() {
      if (delayTimer) {
        clearTimeout(delayTimer);
        delayTimer = null;
      }
    }

    return cleanupTimer;
  }, [loadingOrDelay.delay, loadingOrDelay.loading]);

  // ========================= Two CN Char Check =========================
  /**
   * 两个中文字符检查
   * 用于自动在两个中文字符之间插入空格
   */
  useEffect(() => {
    // FIXME: 对于 HOC 用法（如 <FormatMessage />）的处理
    if (!buttonRef.current || !mergedInsertSpace) {
      return;
    }
    const buttonText = buttonRef.current.textContent || '';
    // 如果需要插入空格且文本包含两个中文字符
    if (needInserted && isTwoCNChar(buttonText)) {
      if (!hasTwoCNChar) {
        setHasTwoCNChar(true);
      }
    } else if (hasTwoCNChar) {
      // 如果不再需要，清除标记
      setHasTwoCNChar(false);
    }
  });

  // ========================= Auto Focus =========================
  /**
   * 自动聚焦
   * 如果设置了 autoFocus 属性，组件挂载后自动聚焦
   */
  useEffect(() => {
    if (autoFocus && buttonRef.current) {
      buttonRef.current.focus();
    }
  }, []);

  // ========================= Events =========================
  /**
   * 点击事件处理
   * 在加载或禁用状态下阻止默认行为
   */
  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement, MouseEvent>) => {
      // FIXME: https://github.com/ant-design/ant-design/issues/30207
      // 如果处于加载状态或禁用状态，阻止点击事件
      if (innerLoading || mergedDisabled) {
        e.preventDefault();
        return;
      }

      // 根据是否有 href 属性，将事件类型转换为对应的类型
      props.onClick?.(
        'href' in props
          ? (e as React.MouseEvent<HTMLAnchorElement, MouseEvent>)
          : (e as React.MouseEvent<HTMLButtonElement, MouseEvent>),
      );
    },
    [props.onClick, innerLoading, mergedDisabled],
  );

  // ========================== Warn ==========================
  /**
   * 开发环境警告
   * 检查不正确的用法并给出提示
   */
  if (process.env.NODE_ENV !== 'production') {
    const warning = devUseWarning('Button');

    // 警告：icon 属性在 v4 中应使用 ReactNode 而非字符串
    warning(
      !(typeof icon === 'string' && icon.length > 2),
      'breaking',
      `\`icon\` is using ReactNode instead of string naming in v4. Please check \`${icon}\` at https://ant.design/components/icon`,
    );

    // 警告：link 或 text 按钮不能是 ghost 按钮
    warning(
      !(ghost && isUnBorderedButtonVariant(mergedVariant)),
      'usage',
      "`link` or `text` button can't be a `ghost` button.",
    );
  }

  // ========================== Size ==========================
  // 从紧凑模式上下文获取尺寸和类名
  const { compactSize, compactItemClassnames } = useCompactItemContext(prefixCls, direction);

  // 尺寸类名映射：将完整尺寸名称映射为简短的类名后缀
  const sizeClassNameMap = { large: 'lg', small: 'sm', middle: undefined };

  // 合并尺寸：优先级为自定义尺寸 > 紧凑模式尺寸 > 按钮组尺寸 > 上下文尺寸
  const sizeFullName = useSize((ctxSize) => customizeSize ?? compactSize ?? groupSize ?? ctxSize);

  // 获取尺寸类名后缀
  const sizeCls = sizeFullName ? (sizeClassNameMap[sizeFullName] ?? '') : '';

  // 确定图标类型：加载时显示加载图标，否则显示自定义图标
  const iconType = innerLoading ? 'loading' : icon;

  // 过滤掉 navigate 属性（用于链接按钮，避免传递给 DOM）
  const linkButtonRestProps = omit(rest as ButtonProps & { navigate: any }, ['navigate']);

  // ========================= Render =========================
  /**
   * 合并类名
   * 根据组件的各种状态和配置生成完整的类名列表
   */
  const classes = classNames(
    prefixCls,
    hashId,
    cssVarCls,
    {
      // 形状类名（非默认形状时添加）
      [`${prefixCls}-${shape}`]: shape !== 'default' && shape,
      // 兼容 5.21.0 之前的版本
      [`${prefixCls}-${mergedType}`]: mergedType,
      // 危险按钮类名
      [`${prefixCls}-dangerous`]: danger,
      // 颜色类名
      [`${prefixCls}-color-${mergedColorText}`]: mergedColorText,
      // 变体类名
      [`${prefixCls}-variant-${mergedVariant}`]: mergedVariant,
      // 尺寸类名
      [`${prefixCls}-${sizeCls}`]: sizeCls,
      // 仅图标按钮类名（无子元素但有图标）
      [`${prefixCls}-icon-only`]: !children && children !== 0 && !!iconType,
      // 幽灵按钮类名（非无边框变体时）
      [`${prefixCls}-background-ghost`]: ghost && !isUnBorderedButtonVariant(mergedVariant),
      // 加载状态类名
      [`${prefixCls}-loading`]: innerLoading,
      // 两个中文字符类名（用于自动插入空格）
      [`${prefixCls}-two-chinese-chars`]: hasTwoCNChar && mergedInsertSpace && !innerLoading,
      // 块级按钮类名
      [`${prefixCls}-block`]: block,
      // RTL 方向类名
      [`${prefixCls}-rtl`]: direction === 'rtl',
      // 图标在末尾类名
      [`${prefixCls}-icon-end`]: iconPosition === 'end',
    },
    compactItemClassnames,
    className,
    rootClassName,
    contextClassName,
  );

  // 合并样式：上下文样式 + 自定义样式
  const fullStyle: React.CSSProperties = { ...contextStyle, ...customStyle };

  // 合并图标类名和样式
  const iconClasses = classNames(customClassNames?.icon, contextClassNames.icon);
  const iconStyle: React.CSSProperties = {
    ...(styles?.icon || {}),
    ...(contextStyles.icon || {}),
  };

  /**
   * 图标节点渲染
   * 根据加载状态和配置决定显示哪个图标
   */
  const iconNode =
    // 有自定义图标且不在加载状态：显示自定义图标
    icon && !innerLoading ? (
      <IconWrapper prefixCls={prefixCls} className={iconClasses} style={iconStyle}>
        {icon}
      </IconWrapper>
    ) : // 加载状态且有自定义加载图标：显示自定义加载图标
    loading && typeof loading === 'object' && loading.icon ? (
      <IconWrapper prefixCls={prefixCls} className={iconClasses} style={iconStyle}>
        {loading.icon}
      </IconWrapper>
    ) : (
      // 默认情况：显示默认加载图标
      <DefaultLoadingIcon
        existIcon={!!icon}
        prefixCls={prefixCls}
        loading={innerLoading}
        mount={isMountRef.current}
      />
    );

  /**
   * 子元素处理
   * 如果有子元素，根据需要在两个中文字符之间插入空格
   */
  const kids =
    children || children === 0 ? spaceChildren(children, needInserted && mergedInsertSpace) : null;

  // ========================= Link Button =========================
  /**
   * 链接按钮渲染
   * 如果提供了 href 属性，渲染为 <a> 标签
   */
  if (linkButtonRestProps.href !== undefined) {
    return wrapCSSVar(
      <a
        {...linkButtonRestProps}
        className={classNames(classes, {
          // 禁用状态的链接按钮类名
          [`${prefixCls}-disabled`]: mergedDisabled,
        })}
        // 禁用时移除 href，避免可点击
        href={mergedDisabled ? undefined : linkButtonRestProps.href}
        style={fullStyle}
        onClick={handleClick}
        ref={mergedRef as React.Ref<HTMLAnchorElement>}
        // 禁用时移除 tab 索引，避免键盘导航
        tabIndex={mergedDisabled ? -1 : 0}
        aria-disabled={mergedDisabled}
      >
        {iconNode}
        {kids}
      </a>,
    );
  }

  // ========================= Button Node =========================
  /**
   * 普通按钮渲染
   * 渲染为 <button> 标签
   */
  let buttonNode = (
    <button
      {...rest}
      type={htmlType}
      className={classes}
      style={fullStyle}
      onClick={handleClick}
      disabled={mergedDisabled}
      ref={mergedRef as React.Ref<HTMLButtonElement>}
    >
      {iconNode}
      {kids}
      {/* 紧凑模式样式组件 */}
      {compactItemClassnames && <Compact prefixCls={prefixCls} />}
    </button>
  );

  // ========================= Wave Effect =========================
  /**
   * 波纹效果
   * 对于非无边框变体的按钮，添加点击波纹效果
   */
  if (!isUnBorderedButtonVariant(mergedVariant)) {
    buttonNode = (
      <Wave component="Button" disabled={innerLoading}>
        {buttonNode}
      </Wave>
    );
  }
  return wrapCSSVar(buttonNode);
});

/**
 * 复合组件类型
 * 包含按钮组和内部标识
 */
type CompoundedComponent = typeof InternalCompoundedButton & {
  /** @deprecated 请使用 `Space.Compact` */
  Group: typeof Group;
  /** @internal 内部标识，用于识别 antd 按钮组件 */
  __ANT_BUTTON: boolean;
};

/**
 * 按钮组件
 * 导出为复合组件，包含 Group 子组件
 */
const Button = InternalCompoundedButton as CompoundedComponent;

// 挂载按钮组子组件
Button.Group = Group;
// 设置内部标识
Button.__ANT_BUTTON = true;

// 开发环境下设置显示名称，便于调试
if (process.env.NODE_ENV !== 'production') {
  Button.displayName = 'Button';
}

export default Button;
