data "aws_route53_zone" "main" {
  name         = var.route53_zone_name
  private_zone = false
}

resource "aws_acm_certificate" "algo" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = var.domain_name
  }
}

resource "aws_route53_record" "acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.algo.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.main.zone_id
}

resource "aws_acm_certificate_validation" "algo" {
  certificate_arn         = aws_acm_certificate.algo.arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}

# The A-alias algo.mrcobra.link -> ALB is not managed here: the ALB is created
# by the AWS Load Balancer Controller on first deploy, so the deploy workflow
# UPSERTs that record (scripts/aws/deploy-prod.sh) and the destroy workflow
# deletes it (scripts/aws/teardown-cluster.sh).
