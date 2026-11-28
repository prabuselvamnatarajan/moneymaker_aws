# IRSA for the AWS Load Balancer Controller.
# Install the controller with Helm after terraform apply (see README.md).
# This file only creates the IAM role + policy attachment.

data "tls_certificate" "eks_oidc" {
  url = aws_eks_cluster.prod.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks_oidc.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.prod.identity[0].oidc[0].issuer

  tags = {
    Name = "${var.cluster_name}-oidc"
  }
}

locals {
  oidc_provider = replace(aws_eks_cluster.prod.identity[0].oidc[0].issuer, "https://", "")
}

data "aws_iam_policy_document" "alb_controller_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.eks.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider}:sub"
      values   = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "alb_controller" {
  name               = "${var.cluster_name}-aws-load-balancer-controller"
  assume_role_policy = data.aws_iam_policy_document.alb_controller_assume.json
}

# Official policy for the controller version installed by
# scripts/aws/install-cluster-addons.sh (ALB_CONTROLLER_CHART_VERSION).
# Upgrade both together: download docs/install/iam_policy.json from the
# matching aws-load-balancer-controller release tag into policies/.
resource "aws_iam_policy" "alb_controller" {
  name        = "${var.cluster_name}-aws-load-balancer-controller"
  description = "Permissions for AWS Load Balancer Controller"
  policy      = file("${path.module}/policies/aws-load-balancer-controller-v3.7.0.json")
}

resource "aws_iam_role_policy_attachment" "alb_controller" {
  role       = aws_iam_role.alb_controller.name
  policy_arn = aws_iam_policy.alb_controller.arn
}
