# MoneyMaker Terraform bootstrap (run once, by hand)

Creates the two things the GitHub workflows need before they can run at all:

| Resource | Why |
| --- | --- |
| S3 bucket (versioned, encrypted, private) | Remote state for `terraform/prod`, with S3 native locking |
| GitHub OIDC provider + IAM role `moneymaker-github-actions` | Lets jobs in this repo's `production` / `production-infra` environments get short-lived AWS credentials; no AWS keys in GitHub |

This stack keeps **local** state (it creates the bucket remote state would
live in). Keep `terraform.tfstate` from this folder safe; it is gitignored.

## Steps

Run with AWS credentials that can create IAM roles and S3 buckets (an admin
profile on your machine):

```sh
cd terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars   # set a globally unique state_bucket_name
terraform init
terraform apply
terraform output
```

Then in GitHub (Settings > Secrets and variables > Actions > Variables):

- `AWS_ROLE_ARN` = `github_actions_role_arn`
- `TF_STATE_BUCKET` = `state_bucket`
- `AWS_REGION` = `aws_region` (optional when it is `ap-south-1`)

And create the environments `production` and `production-infra`
(Settings > Environments). Give `production-infra` required reviewers.

If the account already has the `token.actions.githubusercontent.com` OIDC
provider, set `create_github_oidc_provider = false`.

The role has `AdministratorAccess` because Terraform manages VPC, EKS, IAM,
EFS, ECR, ACM and Route 53. Only this repository's two environments can assume it.
