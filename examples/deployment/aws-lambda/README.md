# AWS Lambda Deployment

Deploy Reader as an AWS Lambda function.

## Important Considerations

Running a full browser in Lambda is challenging due to:
- Cold start times (Chrome takes 5-10+ seconds to start)
- Memory requirements (2GB+ recommended)
- Binary size limits
- Execution time limits

**Recommendation**: For production browser workloads, consider:
- **AWS ECS/Fargate**: Better suited for long-running browser processes
- **AWS EC2**: Full control over browser lifecycle
- **External Browser Service**: Use Browserless, Browserbase, or similar

## Lambda Container Approach

If you still want to use Lambda, use container images:

### Dockerfile

```dockerfile
FROM public.ecr.aws/lambda/nodejs:18

# Install Chrome dependencies
RUN yum install -y \
    alsa-lib \
    atk \
    cups-libs \
    gtk3 \
    ipa-gothic-fonts \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXScrnSaver \
    libXtst \
    pango \
    xorg-x11-fonts-100dpi \
    xorg-x11-fonts-75dpi \
    xorg-x11-fonts-cyrillic \
    xorg-x11-fonts-misc \
    xorg-x11-fonts-Type1 \
    xorg-x11-utils

# Copy function code
COPY package*.json ./
RUN npm install --production
COPY . .

CMD ["handler.handler"]
```

### Build and Deploy

```bash
# Build container
docker build -t reader-lambda .

# Push to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REPO
docker tag reader-lambda:latest $ECR_REPO/reader-lambda:latest
docker push $ECR_REPO/reader-lambda:latest

# Create/update Lambda
aws lambda create-function \
  --function-name reader \
  --package-type Image \
  --code ImageUri=$ECR_REPO/reader-lambda:latest \
  --role arn:aws:iam::ACCOUNT:role/lambda-role \
  --memory-size 2048 \
  --timeout 60
```

## API Gateway Integration

```yaml
# SAM template
Resources:
  ReaderFunction:
    Type: AWS::Serverless::Function
    Properties:
      PackageType: Image
      MemorySize: 2048
      Timeout: 60
      Events:
        Api:
          Type: Api
          Properties:
            Path: /scrape
            Method: post
```

## Alternative: Use Remote Browser

Instead of running Chrome in Lambda, connect to a remote browser service:

```typescript
import { scrape } from "@vakra-dev/reader";

const result = await scrape({
  urls: ["https://example.com"],
  connectionToCore: "wss://browserless.io?token=YOUR_TOKEN",
});
```

This approach:
- Eliminates cold starts
- No Chrome binary in Lambda
- Faster, more reliable
- Scales independently
