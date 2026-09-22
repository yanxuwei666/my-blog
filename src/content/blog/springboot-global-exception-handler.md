---
title: "Spring Boot 统一异常处理与参数校验落地实践"
description: "接口层同时存在 try-catch、自定义 Result 和直接抛 RuntimeException 三种风格时，异常处理的价值才真正体现：把错误码、参数校验、日志和响应格式收敛到一个切面上。"
pubDate: 2026-09-18
tags: ["springboot", "java", "backend", "exception-handling"]
draft: false
---

## 1. 现状与痛点

多数 Spring Boot 项目里的异常处理都是这样长出来的：

第一个接口写了 `try { ... } catch (Exception e) { return Result.fail(e.getMessage()); }`，第二个接口懒得处理直接往外抛，第三个接口接了全局处理器但只返回 HTTP 500 加一坨堆栈。前端拿到的响应有三种结构，参数错误的提示有时是「不能为空」，有时是「Validation failed for argument [0]」。

再往后会出现两个更难查的问题：

1. 异常被 `catch` 后只打了 `e.getMessage()`，日志里没有堆栈，线上出问题只能靠猜；
2. 数据库唯一索引冲突、参数越界、业务规则不满足，全都返回同一个 `500 系统异常`，前端没法针对性处理。

统一异常处理要解决的就是这两件事：**响应结构唯一**，**错误语义可区分**。

## 2. 方案概述

### 2.1 整体思路

分层兜底，越靠近业务层的异常越具体：

```text
Controller 参数绑定失败
   └─ MethodArgumentNotValidException     → 400 + 字段级错误
Service 业务规则不满足
   └─ BusinessException(ErrorCode)        → 400/409 + 业务码
框架与第三方异常
   └─ HttpRequestMethodNotSupportedException → 405
   └─ DuplicateKeyException                → 409 + 数据已存在
未预期异常
   └─ Exception                            → 500 + 固定文案 + 完整堆栈日志
```

### 2.2 关键组件

| 组件 | 职责 |
| --- | --- |
| `ErrorCode` 枚举 | 集中定义错误码、默认文案、HTTP 状态 |
| `BusinessException` | 携带 `ErrorCode` 的可预期异常 |
| `Result<T>` | 全站唯一响应结构 |
| `GlobalExceptionHandler` | 一个 `@RestControllerAdvice` 类承接所有异常 |

### 2.3 相关链接

- Spring 官方文档：[ControllerAdvice](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-advice.html)
- Bean Validation：[Jakarta Validation](https://beanvalidation.org/)

## 3. 实现步骤

### 3.1 先定义错误码

错误码不要随手写字符串。用一个枚举把码、文案、HTTP 状态绑在一起，后面所有分支都从这里取值。

```java
public enum ErrorCode {

    PARAM_INVALID("A0400", "请求参数不合法", HttpStatus.BAD_REQUEST),
    DATA_NOT_FOUND("A0501", "数据不存在", HttpStatus.NOT_FOUND),
    DATA_DUPLICATE("A0502", "数据已存在", HttpStatus.CONFLICT),
    SYSTEM_ERROR("B0001", "系统繁忙，请稍后重试", HttpStatus.INTERNAL_SERVER_ERROR);

    private final String code;
    private final String message;
    private final HttpStatus status;

    ErrorCode(String code, String message, HttpStatus status) {
        this.code = code;
        this.message = message;
        this.status = status;
    }

    public String getCode() { return code; }
    public String getMessage() { return message; }
    public HttpStatus getStatus() { return status; }
}
```

### 3.2 业务异常

可预期的失败一律走 `BusinessException`，它只是一个错误码载体，不需要填堆栈。

```java
public class BusinessException extends RuntimeException {

    private final ErrorCode errorCode;

    public BusinessException(ErrorCode errorCode) {
        this(errorCode, errorCode.getMessage());
    }

    public BusinessException(ErrorCode errorCode, String message) {
        super(message, null, false, false); // 不需要堆栈，省掉 fillInStackTrace 开销
        this.errorCode = errorCode;
    }

    public ErrorCode getErrorCode() { return errorCode; }
}
```

`super(message, null, false, false)` 的后两个参数关掉 writableStackTrace 和 stacktrace 填充。业务异常每秒可能抛几百次，采集堆栈的代价并不便宜。

### 3.3 统一响应体

```java
public record Result<T>(String code, String message, T data, long timestamp) {

    public static <T> Result<T> ok(T data) {
        return new Result<>("0", "success", data, System.currentTimeMillis());
    }

    public static <T> Result<T> fail(ErrorCode errorCode, String message) {
        return new Result<>(errorCode.getCode(), message, null, System.currentTimeMillis());
    }
}
```

### 3.4 参数校验先就位

```java
public record CreateOrderRequest(
        @NotNull(message = "用户ID不能为空") Long userId,
        @NotBlank(message = "收货地址不能为空") @Size(max = 200, message = "地址过长") String address,
        @NotEmpty(message = "至少选择一件商品") List<ItemRequest> items
) {}
```

```java
@PostMapping
public Result<Long> create(@Valid @RequestBody CreateOrderRequest request) {
    return Result.ok(orderService.create(request));
}
```

`@Valid` 不能省。少了它，`@NotNull` 只是几个注解而已。

### 3.5 全局处理器

```java
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<Result<Void>> handleBusiness(BusinessException e) {
        ErrorCode code = e.getErrorCode();
        log.warn("业务异常 code={} message={}", code.getCode(), e.getMessage());
        return ResponseEntity.status(code.getStatus())
                .body(Result.fail(code, e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Result<Void>> handleInvalidArgument(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .map(err -> err.getField() + ": " + err.getDefaultMessage())
                .collect(Collectors.joining("; "));
        log.warn("参数校验失败 {}", message);
        return ResponseEntity.badRequest().body(Result.fail(ErrorCode.PARAM_INVALID, message));
    }

    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<Result<Void>> handleDuplicateKey(DuplicateKeyException e) {
        log.warn("唯一索引冲突", e);
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Result.fail(ErrorCode.DATA_DUPLICATE, "数据已存在"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Result<Void>> handleUnknown(Exception e) {
        log.error("未处理异常", e);
        return ResponseEntity.internalServerError()
                .body(Result.fail(ErrorCode.SYSTEM_ERROR, ErrorCode.SYSTEM_ERROR.getMessage()));
    }
}
```

顺序很重要：越具体的 `@ExceptionHandler` 放越前面，`Exception.class` 兜底放最后。Spring 按类型匹配最贴近的那个，和书写顺序无关，但读代码的人依赖这个顺序。

### 3.6 验证跑通

```bash
curl -i -X POST http://localhost:8080/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"userId": null, "address": "", "items": []}'
```

期望结果：HTTP 400，`code` 为 `A0400`，`message` 里能看到三个字段各自的提示。

```text
HTTP/1.1 400
{"code":"A0400","message":"userId: 用户ID不能为空; address: 收货地址不能为空; items: 至少选择一件商品","data":null,"timestamp":1770000000000}
```

再测一条业务异常，确认 HTTP 状态和错误码都来自 `ErrorCode`，而不是恒定的 200 或 500。

## 4. 关键细节

**HTTP 状态码不要全给 200。** 有些团队习惯永远返回 200，靠 `code` 区分。这样网关、监控、重试策略就失去了判断依据——`5xx` 比例是最省事的告警指标。业务失败用 4xx，系统故障用 5xx，更贴合 HTTP 语义。

**别把堆栈返回给前端。** `Result` 里不放 `exception` 字段。堆栈进日志，接口只给可展示的文案。

**`@RestControllerAdvice` 的 basePackages 要收窄。** 一个仓库里有多个 Spring Boot 应用时，用 `@RestControllerAdvice(basePackages = "com.example.order")` 限定作用范围，避免误伤。

**Filter 里的异常走不到 `@RestControllerAdvice`。** 它在 DispatcherServlet 之后生效。JWT 解析这类 Filter 异常，需要单独写一个 `HandlerExceptionResolver` 或在 Filter 内直接写响应。

**`@Valid` 对 `@RequestParam` 无效。** 方法级参数校验要在类上加 `@Validated`，否则 `@NotNull Long id` 不会生效。

## 5. 常见问题

**为什么我的 `BusinessException` 变成了 500？**
大概率是它在 Service 里被自己 `catch` 掉又包了一层 `RuntimeException`。业务异常要往外抛，不要在中间层吞。

**为什么参数错误没有进 `MethodArgumentNotValidException` 分支？**
`@RequestBody` 上的校验才会抛这个异常；表单提交是 `BindException`，路径变量是 `ConstraintViolationException`。三种都要接，或者让处理器同时声明这几个类型。

**能不能只在日志里打 message？**
反过来说，只打 message 才是常态 bug 的根源。业务异常打 `warn` + 错误码即可，未预期异常必须 `log.error("...", e)` 把异常对象传进去，否则没有堆栈。

## 6. 总结与延伸

核心要点：

- 错误码枚举统一维护码、文案、HTTP 状态三件事
- 可预期失败抛 `BusinessException`，不可预期失败交给兜底分支
- 参数校验的字段级错误要拼成可读提示返回
- 未预期异常记完整堆栈，对外只给固定文案

继续往下可以做的问题：

- 错误码要不要按模块分段，怎么避免重复
- 国际化场景下文案如何按 `Accept-Language` 切换
- 网关聚合多个服务时，错误码前缀怎么统一
