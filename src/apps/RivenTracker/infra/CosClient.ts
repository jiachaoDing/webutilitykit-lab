export interface CosConfig {
  bucket: string;
  region: string;
  secretId: string;
  secretKey: string;
}

export class CosClient {
  constructor(private config: CosConfig) {}

  /**
   * 上传文件到 COS
   */
  async putObject(key: string, body: string, contentType: string = 'application/json') {
    const { bucket, region, secretId } = this.config;
    const host = `${bucket}.cos.${region}.myqcloud.com`;
    const url = `https://${host}/${key.startsWith('/') ? key.slice(1) : key}`;
    const method = 'put';
    
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600; // 1小时有效期
    const qSignTime = `${now};${exp}`;
    const qKeyTime = `${now};${exp}`;

    // 1. 生成 SignKey
    const signKey = await this.hmacSha1(this.config.secretKey, qKeyTime, true) as string;
    
    // 2. 生成 HttpString
    // 为简化，仅包含必要的 host
    const httpMethod = method.toLowerCase();
    const httpUri = key.startsWith('/') ? key : `/${key}`;
    const httpParameters = '';
    const httpHeaders = `content-type=${contentType.toLowerCase()}&host=${host.toLowerCase()}`;
    const httpString = `${httpMethod}\n${httpUri}\n${httpParameters}\n${httpHeaders}\n`;

    // 3. 生成 StringToSign
    const sha1HttpString = await this.sha1(httpString);
    const stringToSign = `sha1\n${qSignTime}\n${sha1HttpString}\n`;

    // 4. 生成 Signature
    const signature = await this.hmacSha1(signKey, stringToSign, true) as string;

    // 5. 构造 Authorization 头部
    const authHeader = [
      `q-sign-algorithm=sha1`,
      `q-ak=${secretId}`,
      `q-sign-time=${qSignTime}`,
      `q-key-time=${qKeyTime}`,
      `q-header-list=content-type;host`,
      `q-url-param-list=`,
      `q-signature=${signature}`
    ].join('&');

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': contentType,
        'Host': host
      },
      body: body
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`COS Upload Failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response;
  }

  private async hmacSha1(key: string | ArrayBuffer, data: string, returnHex: boolean = false): Promise<string | ArrayBuffer> {
    const encoder = new TextEncoder();
    const keyData = typeof key === 'string' ? encoder.encode(key) : key;
    const msgData = encoder.encode(data);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);

    if (returnHex) {
      return Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    return signature;
  }

  private async sha1(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const msgData = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgData);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

