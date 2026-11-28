# MoneyMaker prod Terraform (EKS)

Provisions the AWS infrastructure for the `k8s/overlays/prod` overlay.
Normally applied by the **Infrastructure Apply** workflow
(`.github/workflows/infra-apply.yml`) and removed by **Infrastructure Destroy**.
State lives in the S3 bucket created by [`../bootstrap`](../bootstrap).

## What it creates

| Resource | Purpose |
| --- | --- |
| VPC, 3 public + 3 private subnets, NAT gateway | Network for EKS and the ALB |
| EKS cluster + managed node group (`t3a.large`, one AZ, 1–6, sized by Cluster Autoscaler) | Kubernetes control plane and workers |
| EKS access entries (`cluster_admin_arns`) | Who can use kubectl (GitHub role + `EKS_ADMIN_ARNS`) |
| EBS CSI + EFS CSI add-ons (IRSA roles in `csi_iam.tf`) | gp3 volumes for Mongo/Redis; RWX EFS volumes |
| EFS + access points | Mongo init signal and shared `backtest-data` |
| ECR repositories (one per custom image) | Prod pulls app images from here, not Docker Hub |
| ACM certificate + Route 53 DNS validation | TLS for `algo.mrcobra.link` at the ALB |
| IAM role (IRSA) for AWS Load Balancer Controller | Official policy in `policies/` |
| IAM role (IRSA) for Cluster Autoscaler | Scales only this cluster's node groups (`cluster_autoscaler_iam.tf`) |

Prerequisite: the Route 53 hosted zone `mrcobra.link` already exists.

Not in Terraform (and why):

- **AWS Load Balancer Controller, metrics-server, Cluster Autoscaler, StorageClasses** are installed
  by `scripts/aws/install-cluster-addons.sh` right after apply (same workflow).
  It also writes ConfigMap `kube-system/moneymaker-infra` with the outputs the
  app deploy needs (cert ARN, ECR registry, zone id).
- **`algo.mrcobra.link` → ALB alias** is UPSERTed by `scripts/aws/deploy-prod.sh`,
  because the ALB only exists after the first app deploy creates the Ingress.

## Full flow

1. Once: `terraform/bootstrap` (state bucket + GitHub OIDC role) and the GitHub
   variables/secrets in `.github/workflows/deploy-secrets.example.txt`.
2. Actions → **Infrastructure Apply** → `apply = false` to review the plan,
   then `apply = true` and approve. (~20–30 min the first time.)
3. Set repository variable `PROD_DEPLOY_ENABLED=true`.
4. Every push to `main`: CI builds, tests, and the **Deploy to EKS** job ships it.
5. Infra changes later: edit these `.tf` files, merge, run Infrastructure Apply again.
6. To remove everything: Actions → **Infrastructure Destroy**, type the cluster
   name, approve. All data is deleted.

## Running by hand

```sh
export TF_STATE_BUCKET=<bootstrap state_bucket> AWS_REGION=ap-south-1
./scripts/aws/tf-init.sh
cd terraform/prod
terraform plan -var 'cluster_admin_arns=["arn:aws:iam::<acct>:role/moneymaker-github-actions"]'
```

Pass the same `cluster_admin_arns` the workflow uses (GitHub role plus
`EKS_ADMIN_ARNS`), or a local apply will remove the workflow's cluster access.

## Upgrading the Load Balancer Controller

Bump `ALB_CONTROLLER_CHART_VERSION` in `scripts/aws/install-cluster-addons.sh`
and replace `policies/aws-load-balancer-controller-v*.json` with
`docs/install/iam_policy.json` from the matching controller release tag.
