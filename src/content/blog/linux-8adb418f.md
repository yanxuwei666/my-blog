---
title: "Linux-搭建内网依赖库"
description: "在企业的内网生产环境中，服务器通常无法直接访问互联网，这给软件包的安装和更新带来了巨大挑战。传统的做法是在每台机器上单独上传 .deb​ 包并通过 dpkg -i​ 安装，但这种方式不仅效率低下，而且难以处理复杂的依赖关系。本文旨在提供一套完整的 Ubuntu 离线镜像源搭建方案，帮助运维人员在内网环境中快速部署本地 "
pubDate: 2026-10-08
category: "操作系统"
tags: ["运维", "DevOps", "linux"]
draft: false
source: "siyuan"
siyuanId: "20260828211046-v1baw4b"
slug: "linux-8adb418f"
sourceHash: "sha256:2f7173233996df0f71c75ddd58f4aed84cdd323f92318edc863c859c858aa7c2"
---
## 前言

在企业的内网生产环境中，服务器通常无法直接访问互联网，这给软件包的安装和更新带来了巨大挑战。传统的做法是在每台机器上单独上传 `.deb`​ 包并通过 `dpkg -i`​ 安装，但这种方式不仅效率低下，而且难以处理复杂的依赖关系。本文旨在提供一套完整的 Ubuntu 离线镜像源搭建方案，帮助运维人员在内网环境中快速部署本地 APT 仓库，实现 `apt-get install` 的丝滑体验。

本文将从两种典型场景入手：一是​**手动构建轻量级镜像源**​，使用 `reprepro`​ 工具从零创建仅包含常用软件包及其依赖的本地仓库，整体大小控制在 1GB 以内，适用于大多数中小型内网环境；二是​**完整同步官方镜像源**​，使用 `apt-mirror`​ 工具完整镜像 Ubuntu 24.04 官方仓库，适用于需要全量软件包支持的大型生产环境。无论您选择哪种方式，最终都将通过 Nginx 对外提供服务，使内网任意机器仅需配置本地源地址即可享受与外网无异的 `apt` 使用体验。

## 环境准备

这里需要说明一下，就是内外网得环境和系统版本均要保持一致，不一致同步会出现问题。

|角色|系统|说明|
| ------------| -----------------------| ---------------------|
|外网机器|Ubuntu 24.04 (WSL)|用于下载软件包|
|内网服务器|Ubuntu 24.04 (虚拟机)|部署Nginx提供源服务|
|内网客户端|Ubuntu 24.04|通过内网源安装软件|

完整流程图如下：

```bash
外网机器（有网络）                        内网服务器（无网络）
    │
    ├─ 1. 安装 reprepro
    ├─ 2. 下载 deb 包
    ├─ 3. 用 reprepro 构建仓库
    │    └─ 生成完整的 pool/ 和 dists/
    ├─ 4. 打包 tar.gz
    │
    │    scp / U盘 传输
    │    ──────────────────────────────►
    │                                     ├─ 5. 解压 tar.gz
    │                                     ├─ 6. 用 dpkg 安装 nginx
    │                                     ├─ 7. 配置 nginx
    │                                     ├─ 8. 配置客户端源
    │                                     └─ 9. apt-get install 测试
```

## 外网机器：下载镜像源

### 安装apt-mirror

```bash
sudo apt update
sudo apt install apt-mirror
```

### 配置软件包镜像源

注意，这里要说明一下`sources.list`​ 和 `mirror.list`​ 得区别，`sources.list`​是告诉你的电脑去哪里下载软件包的“购物清单”，而`mirror.list`则是用于创建你自己的“本地仓库”的“进货清单”。

```bash
# 备份当前源
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak

# 换成腾讯云源
sudo tee /etc/apt/sources.list << 'EOF'
deb https://mirrors.cloud.tencent.com/ubuntu noble main restricted universe multiverse
deb https://mirrors.cloud.tencent.com/ubuntu noble-updates main restricted universe multiverse
deb https://mirrors.cloud.tencent.com/ubuntu noble-security main restricted universe multiverse
EOF

# 更新源列表
sudo apt update
sudo apt upgrade
```

### 配置下载包镜像源

```bash
# 这里以Ubuntu24.04为例，只镜像amd64架构以节省空间
sudo tee /etc/apt/mirror.list << 'EOF'
set base_path    /var/spool/apt-mirror
set nthreads     20
set defaultarch  amd64
set skip_cleanup 0

# 使用腾讯云源（速度最快 2.54 MB/s）
deb https://mirrors.cloud.tencent.com/ubuntu noble main restricted universe multiverse
deb https://mirrors.cloud.tencent.com/ubuntu noble-updates main restricted universe multiverse
deb https://mirrors.cloud.tencent.com/ubuntu noble-security main restricted universe multiverse

# 清理过期包
clean https://mirrors.cloud.tencent.com/ubuntu
EOF
```

### 同步ubuntu镜像源到本地。

1、下载 ubuntu 镜像源到本地。首次同步时间很长（可能几小时到十几小时），取决于网络速度和镜像大小（约80-150GB）。

```bas
# 用 screen 或 tmux 防止断开
screen -S mirror
sudo apt-mirror
# Ctrl+A+D 可以脱离会话，之后用 screen -r mirror 恢复查看


# 镜像下载完成后，打包
sudo tar -czvf ubuntu_mirror.tar.gz -C /var/spool/apt-mirror/mirror .
```

2、预期目录结构如下：

```bash
/var/spool/apt-mirror/mirror/archive.ubuntu.com/ubuntu/
├── dists/
│   └── noble/
│       ├── main/
│       ├── restricted/
│       ├── universe/
│       ├── multiverse/
│       ├── noble-updates/
│       └── noble-security/
└── pool/
    ├── main/
    ├── restricted/
    ├── universe/
    └── multiverse/
```

### 同步个别软件包模拟Ubuntu镜像源到本地

这里使用`reprepro`构建完整仓库目录结构，做到和ubuntu镜像源仓库目录结构一模一样，APT 就能正确识别并使用了。

1、外网安装`reprepro`。

```bash
# 外网机器有网络，可以直接安装
sudo apt-get update
sudo apt-get install -y reprepro gnupg
```

2、下载需要的软件包。

```bash
# 创建工作目录
mkdir ~/ubuntu_mirror
cd ~/ubuntu_mirror

# 下载所需软件包（仅下载，不安装）
sudo apt-get install --download-only --reinstall -y net-tools vim wget nginx curl git

# 复制所有 .deb 包到工作目录
sudo cp /var/cache/apt/archives/*.deb .
```

3、在外网使用 `reprepro` 构建完整的仓库目录结构。

```bash
# 创建仓库根目录（在外网机器上）
REPO_DIR=~/ubuntu_mirror
mkdir -p ${REPO_DIR}/{conf,dists,pool,db,incoming}

# 创建 distributions 配置文件
cat > ${REPO_DIR}/conf/distributions << 'EOF'
Origin: My-Local-Mirror
Label: My-Local-Mirror
Suite: noble
Codename: noble
Architectures: amd64
Components: main
Description: My local Ubuntu 24.04 mirror for offline deployment
EOF

# 将 .deb 包导入仓库（在外网完成！）
reprepro -b ${REPO_DIR} includedeb noble ~/ubuntu_mirror/*.deb
```

4、查看生成的`~/ubuntu_mirror`目录结构，已经和Ubuntu官方源完全一致。

```bash
~/ubuntu_mirror/
├── pool/
│   └── main/
│       ├── net-tools_*.deb
│       ├── vim_*.deb
│       ├── wget_*.deb
│       ├── nginx_*.deb
│       └── (所有依赖包...)
└── dists/
    └── noble/
        ├── Release
        ├── main/
        │   └── binary-amd64/
        │       ├── Packages
        │       ├── Packages.gz
        │       └── Release
        └── (其他架构目录)
```

5、打包并传输到内网服务器。

```bash
cd ~
tar -czf ubuntu_mirror.tar.gz ubuntu_mirror/
```

### 同步个别软件包镜像源到本地。

这里用来只下载几个软件包到本地，用来模拟ubuntu镜像源同步，节省测试时间。

1、创建工作目录。

```bash
# 创建镜像源工作目录
mkdir -p ~/ubuntu_mirror/pool/main
cd ~/ubuntu_mirror
```

2、下载所需软件包并复制包文件。

```bash
# 更新包列表
sudo apt-get update

# 下载vim及其所有依赖（即使已安装也会重新下载），下载的包默认会放到/var/cache/apt/archives这个目录下
sudo apt-get install --download-only --reinstall -y vim wget nginx curl

# 将下载的deb包从apt缓存复制到工作目录
sudo cp /var/cache/apt/archives/*.deb ~/ubuntu_mirror/pool/main/
```

3、生成包索引文件，就是让下载的包路径与默认的ubuntu镜像源路径类型。

```bash
# 创建发行版目录结构（noble为Ubuntu 24.04的代号）
mkdir -p ~/ubuntu_mirror/dists/noble/main/binary-amd64

# 生成索引文件（压缩版，apt update时使用）
dpkg-scanpackages pool/main /dev/null | gzip -9c > ~/ubuntu_mirror/dists/noble/main/binary-amd64/Packages.gz

# 生成索引文件（未压缩版，备用）
dpkg-scanpackages pool/main /dev/null > ~/ubuntu_mirror/dists/noble/main/binary-amd64/Packages
```

4、生成Release文件。

```bash
# Release文件是apt源的标准组成部分
cat > ~/ubuntu_mirror/dists/noble/Release << 'EOF'
Origin: Ubuntu-Mirror
Label: Ubuntu-Mirror
Suite: noble
Version: 24.04
Codename: noble
Date: $(date -R)
Architectures: amd64
Components: main
Description: Local Ubuntu mirror for offline deployment
EOF
```

5、验证目录结构。

```bash
# 检查目录结构是否正确
sudo apt install tree
tree ~/ubuntu_mirror/

# 预期输出：
yxw@DESKTOP-UUHPCTQ:~$ tree ~/ubuntu_mirror/
/home/yxw/ubuntu_mirror/
├── dists
│   └── noble
│       ├── Release
│       └── main
│           └── binary-amd64
│               ├── Packages
│               └── Packages.gz
└── pool
    └── main
        ├── curl_8.5.0-2ubuntu10.13_amd64.deb
        ├── net-tools_2.10-0.1ubuntu4.4_amd64.deb
        ├── nginx-common_1.24.0-2ubuntu7.17_all.deb
        ├── nginx_1.24.0-2ubuntu7.17_amd64.deb
        ├── vim_2%3a9.1.0016-1ubuntu7.20_amd64.deb
        └── wget_1.21.4-1ubuntu4.5_amd64.deb

7 directories, 9 files
```

6、打包传输。

```bash
# 打包整个镜像源目录
cd ~
tar -czf ubuntu_mirror.tar.gz ubuntu_mirror/

# 通过SCP或U盘等方式将 ubuntu_mirror.tar.gz 传输到内网服务器
```

## 内网机器：部署镜像源

### 解压离线包

```bash
# 将 tar.gz 文件解压到用户目录
cd ~
tar -xzf ubuntu_mirror.tar.gz
```

### 安装Nginx

注意，使用dpkg -i *.deb 的目的是把所有依赖包一并安装，免得出现有的依赖包又依赖其他包的问题。

```bash
# 进入deb包目录
cd ~/ubuntu_mirror/pool/main/n/nginx

# 使用dpkg安装所有包（多执行几次确保依赖完整）
sudo dpkg -i *.deb 2>/dev/null || true
sudo dpkg -i *.deb

# 验证nginx安装成功
yxw@ubuntu-192:~/ubuntu_mirror/pool/main$ nginx -v
nginx version: nginx/1.24.0 (Ubuntu)
```

### 启动Nginx服务

```bash
# 启动nginx
sudo systemctl start nginx

# 设置开机自启
sudo systemctl enable nginx

# 检查服务状态
sudo systemctl status nginx
```

### 配置Nginx显示镜像源目录列表

1、将镜像源内容复制到Nginx根目录中。

```bash
# 清空Nginx默认根目录（备份原有文件）
sudo rm -rf /var/www/html/*

# 将镜像源内容复制到Nginx根目录
sudo cp -r ~/ubuntu_mirror/* /var/www/html/

# 设置权限（nginx用户为www-data）
sudo chown -R www-data:www-data /var/www/html/
sudo chmod -R 755 /var/www/html/
```

2、配置Nginx显示目录列表。

```bash
# 编辑默认站点配置文件
sudo vi /etc/nginx/sites-available/default

# 将文件内容替换为以下配置
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    
    # 根目录指向镜像源文件位置
    root /var/www/html;
    
    # 开启目录浏览，显示可用包列表
    location / {
        autoindex on;               # 启用目录列表
        autoindex_exact_size off;   # 显示人性化文件大小
        autoindex_localtime on;     # 显示本地时间
    }

     # 额外增加的缓存配置
    location ~* \.(deb|gz|bz2|xz)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

3、重启Nginx使配置生效。

```bash
# 测试配置文件语法并重启nginx
sudo nginx -t && systemctl restart nginx
```

4、验证源服务可用。

```bash
# 验证目录浏览是否正常
curl http://localhost/

# 验证Packages.gz文件是否可访问
curl -I http://localhost/dists/noble/main/binary-amd64/Packages.gz

# 预期结果
yxw@ubuntu-192:~/ubuntu_mirror/pool/main/c/curl$ cd ~
yxw@ubuntu-192:~$ curl http://localhost/
<html>
<head><title>Index of /</title></head>
<body>
<h1>Index of /</h1><hr><pre><a href="../">../</a>
<a href="conf/">conf/</a>                                              29-Aug-2026 16:10       -
<a href="db/">db/</a>                                                29-Aug-2026 16:10       -
<a href="dists/">dists/</a>                                             29-Aug-2026 16:10       -
<a href="incoming/">incoming/</a>                                          29-Aug-2026 16:10       -
<a href="pool/">pool/</a>                                              29-Aug-2026 16:10       -
</pre><hr></body>
</html>
```

5、浏览器访问虚拟机地址。

![image](/images/blog/linux-8adb418f/image-20260829161256-jmtsqa8.png)

## 内网机器：使用镜像源

### 配置APT源

在一台新的内网机器上配置已部署好的ubuntu镜像源：

```bash
# 备份原有源配置
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak

# 配置为本地源（[trusted=yes] 跳过GPG签名验证），这里是自定义软件包的镜像源
echo "deb [trusted=yes] http://192.168.139.101/ noble main" | sudo tee /etc/apt/sources.list

# 配置ubuntu完整本地源
sudo tee /etc/apt/sources.list << 'EOF'
deb [trusted=yes] http://192.168.139.101/archive.ubuntu.com/ubuntu noble main restricted universe multiverse
deb [trusted=yes] http://192.168.139.101/archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse
deb [trusted=yes] http://192.168.139.101/archive.ubuntu.com/ubuntu noble-security main restricted universe multiverse
deb [trusted=yes] http://192.168.139.101/archive.ubuntu.com/ubuntu noble-backports main restricted universe multiverse
EOF
```

### 更新并安装

```bash
# 更新并安装
sudo apt update
sudo apt-get install -y net-tools vim wget nginx
sudo apt upgrade
```

‍

‍
