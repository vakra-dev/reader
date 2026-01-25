# Deployment Examples

Guides for deploying Reader to various platforms.

## Available Guides

### Docker

Containerized deployment with Docker and docker-compose.

[View Example](./docker/)

- Dockerfile with Chrome dependencies
- docker-compose.yml for easy deployment
- Health checks and graceful shutdown
- Production tips

### AWS Lambda

Serverless deployment on AWS Lambda.

[View Example](./aws-lambda/)

- Container-based Lambda function
- API Gateway integration
- Remote browser service recommendation

### Vercel Functions

Serverless deployment on Vercel.

[View Example](./vercel-functions/)

- Serverless function setup
- Remote browser integration
- Edge function alternative

## Platform Recommendations

| Platform | Browser Support | Best For |
|----------|----------------|----------|
| Docker/K8s | Full | Production workloads |
| AWS ECS/Fargate | Full | Scalable cloud deployment |
| AWS EC2 | Full | Full control |
| AWS Lambda | Limited* | Low-traffic, with remote browser |
| Vercel | Limited* | Low-traffic, with remote browser |
| Fly.io | Full | Easy global deployment |
| Railway | Full | Simple deployment |

\* Running Chrome in serverless has significant limitations. Use remote browser services for best results.

## Remote Browser Services

For serverless platforms, consider using a remote browser service:

- [Browserless](https://browserless.io) - Chrome as a service
- [Browserbase](https://browserbase.com) - Headless browser infrastructure
- [Apify](https://apify.com) - Web scraping platform
- Self-hosted: Deploy Chrome in a container with WebSocket access
