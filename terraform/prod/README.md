# MoneyMaker prod Terraform (scaffold)

Provisions AWS networking and EKS for the `k8s/overlays/prod` overlay.
**This scaffold is not applied by CI.** Run `terraform plan` / `apply` yourself when ready.

## What it creates

| Resource | Purpose |
| --- | --- |
| VPC + public/private subnets + NAT | Network for EKS and ALB |
| EKS cluster + managed node group | Kubernetes control plane and workers |
| EFS + access points | RWX storage for Mongo init signal and backtest shared volume |
| EFS CSI addon | Mount EFS from pods |
| ACM certificate + Route 53 validation | TLS for `algo.mrcobra.link` |
| Optional Route 53 alias | Points `algo.mrcobra.link` at the ALB once you pass `alb_dns_name` / `alb_zone_id` |
| IAM role (IRSA) for AWS Load Balancer Controller | Used by Helm install below |

## Suggested order

1. Copy `terraform.tfvars.example` → `terraform.tfvars` and adjust.
2. Ensure the Route 53 hosted zone `mrcobra.link` already exists in the account.
3. `terraform init` then `terraform plan` (review) then `terraform apply` when you intend to create resources.
4. Configure kubectl from the `configure_kubectl` output.
5. Install the AWS Load Balancer Controller (Helm), for example:

```sh
helm repo add eks https://aws.github.io/eks-charts
helm repo update
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName="$(terraform output -raw cluster_name)" \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$(terraform output -raw alb_controller_role_arn)"
```

6. Set `fileSystemId` in [`../../k8s/overlays/prod/efs-storageclass.yaml`](../../k8s/overlays/prod/efs-storageclass.yaml) from `efs_file_system_id`, then `kubectl apply -f` that file.
7. Set `CERTIFICATE_ARN` in [`../../k8s/overlays/prod/certificate-arn.env`](../../k8s/overlays/prod/certificate-arn.env) from `acm_certificate_arn`.
8. Push images to a registry the cluster can pull, then:

```sh
./scripts/deploy-k8s.sh --overlay prod --no-import
```

9. Read the ALB hostname from `kubectl -n moneymaker get ingress moneymaker`, set `alb_dns_name` and `alb_zone_id` in tfvars, and re-apply Terraform so Route 53 aliases `algo.mrcobra.link` to the load balancer.

## Notes

- TLS is terminated at the ALB using the ACM certificate. The Kubernetes Ingress does not mount the self-signed `reverse-proxy-tls` secret.
- CPU, memory, and application passwords stay in the shared Kustomize base for now.
- Do not commit `terraform.tfvars` or state files with secrets.
