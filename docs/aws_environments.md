# AWS Environments Comparison & Configuration Reference

This document outlines the resources, credentials, paths, and configurations across the Non-Production (Dev/QA) and Production environments for the `pam-monitor` application.

---

## 1. AWS Accounts & Access Control

The application interacts with two distinct AWS accounts. Access tokens are generated locally via the `cyberpeacock_login` tool.

| Attribute | Non-Prod (Dev & QA) | Production (Prod) |
| :--- | :--- | :--- |
| **AWS Account ID** | `904541710863` | `499127502316` |
| **IAM Role ARN** | `arn:aws:iam::904541710863:role/Engineering` | `arn:aws:iam::499127502316:role/Engineering` |
| **Terminal Login Alias** | `awslogin_nonprod` | `awslogin_prod` |
| **AWS profile name** | `nonprod` | `prod` |

---

## 2. ECS Cluster & Service Mapping

Applications are deployed to AWS Elastic Container Service (ECS) inside their respective clusters:

| Application / Task | QA (Non-Prod) | Production (Prod) |
| :--- | :--- | :--- |
| **ECS Cluster** | `ecs-custom-apps-pam-qa` | `ecs-custom-apps-pam-prod` |
| **Standard App Service** | `{app_id}-service` (e.g. `pamqa-service`) | `{app_id}-service` (e.g. `pamprod-service`) |
| **PSI ECS Service** | `psiqa` | `psiprod` |
| **PSI ECS Task Family** | `psiqa-task-family` | `psiprod-task-family` |
| **Docker Registry ECR** | `904541710863.dkr.ecr.us-east-1.amazonaws.com` | `904541710863.dkr.ecr.us-east-1.amazonaws.com` (Shared) |

---

## 3. S3 Configuration (PSI Payloads)

Both Non-Production and Production environments utilize the **same** S3 bucket residing in the non-prod account to store payload logs. 

- **Bucket Name:** `adsales-appdev-config`
- **Region:** `us-east-1`
- **Access Rule:** S3 queries for all environments run using `nonprod` credentials because the bucket is in the non-prod account.

| Environment | Prefix Path | Environment Config File |
| :--- | :--- | :--- |
| **Dev** | `psi/last_updated/dev/tmp/` | `psi/dev.env` |
| **QA** | `psi/last_updated/qa/tmp/` | `psi/qa.env` |
| **Prod** | `psi/last_updated/prod/tmp/` | `psi/prod.env` |

---

## 4. CloudWatch Logs & EventBridge Schedulers

| Resource | QA (Non-Prod) | Production (Prod) |
| :--- | :--- | :--- |
| **CloudWatch Log Group** | `custom-apps-pam-cloudwatch-qa` | `custom-apps-pam-cloudwatch-prod` |
| **PSI Log Stream Prefix** | `ecs/psiqa/` | `ecs/psiprod/` |
| **EventBridge Rule Name** | `psiqa-task-scheduler` | `psiprod-task-scheduler` |

*Note: Production application log groups reside in the Production AWS account and require `prod` credentials to fetch.*

---

## 5. AWS Secrets Manager Paths

Secrets are named hierarchically. PSI follows a custom Spring Cloud configuration scheme.

| Application / Secret | QA / Dev (Non-Prod) | Production (Prod) |
| :--- | :--- | :--- |
| **Standard App Secret ID** | `pam/{qa\|dev}/{app_secret_name}` | `pam/production/{app_secret_name}` |
| **PSI Secret ID** | `/pam/psi/{qa\|dev}` | `/pam/psi/production` |

---

## 6. Database Configurations

| Database Connection | QA (Non-Prod) | Production (Prod) |
| :--- | :--- | :--- |
| **Gateway DB Host** | `qa-mariadb.customapps.nonprod.adsalescloud.inbcu.com` | `mariadb.customapps.prod.adsalescloud.inbcu.com` |
| **Gateway DB Port** | `1521` | `1521` |
| **Gateway Database** | `agqa` | `agprod` |
| **Gateway DB User** | `agguser_qa` | `agguser` |
| **PSI Oracle DB Host** | *(Resolved from Secrets)* | `ecldblp00007-scan.tfayd.com:15191/P533` (Schema: `smsdbo`) |

---

## 7. Application Log Streaming (AWS vs. Datadog)

### Log Routing Architecture
All backend services run as ECS Fargate containers configured with the standard AWS log driver (`awslogs`). 
1. **CloudWatch (Primary Source):** Container standard output (`stdout`) and standard error (`stderr`) stream immediately into AWS CloudWatch Log Groups.
2. **Datadog (Secondary/Ingested Source):** A log forwarder (such as a Datadog Lambda forwarder subscribing to CloudWatch, or a Kinesis Firehose delivery stream) ingests the logs from CloudWatch into Datadog for visualization and log analytics.

Thus, **active logs are available in both AWS CloudWatch and Datadog**.

### Log Group Mappings for Core Applications in Production
Production log groups reside in the Prod AWS Account (`499127502316`):

*   **PAM (SMS)** (`pam-sms`), **RMX** (`rmx`), **PAM API** (`pam-api`), **PAM API Worker** (`pam-api-worker`), **TAD** (`tad`), **PAM Admin** (`remora`), **Gateway Admin** (`ag-admin`), **Agency Gateway API** (`agency-gateway-api`):
    *   **AWS Log Group:** `custom-apps-pam-cloudwatch-prod`
    *   **Log Stream Prefixes:**
        - SMS: `ecs/pamprod`
        - RMX: `ecs/rmxprod`
        - PAM API: `ecs/pamapiprod`
        - PAM API Worker: `ecs/pamapiprod-worker`
        - TAD: `ecs/tadprod`
        - PAM Admin (Remora): `ecs/pamadminprod`
        - Gateway Admin: `ecs/gatewayadminprod`
        - Agency Gateway API: `ecs/pammanagementprod`

*   **Agency Gateway Worker** (`gateway-worker`):
    *   **AWS Log Group:** `custom-apps-pam-external-cloudwatch-prod`
    *   **Log Stream Prefix:** `ecs/gatewayapiprod-worker`
