import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Badge, Spinner } from 'react-bootstrap';

const Account = ({ appAddress }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${appAddress}/client/account`)
      .then(res => res.json())
      .then(data => {
        setUser(data);
        setLoading(false);
      });
  }, [appAddress]);

  if (loading) return <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 200 }}><Spinner animation="border" /></div>;
  if (!user) return <div className="text-danger">Failed to load user data.</div>;


  const { total, active, inactive } = user.strategies;

  return (
    <Card className="shadow-sm mx-auto" style={{ maxWidth: 500 }}>
      <Card.Body>
        <h4 className="mb-4 text-center">Account Details</h4>
        <Row className="mb-2">
          <Col xs={5} className="fw-semibold">First Name:</Col>
          <Col xs={7}>{user.firstname}</Col>
        </Row>
        <Row className="mb-2">
          <Col xs={5} className="fw-semibold">Last Name:</Col>
          <Col xs={7}>{user.lastname}</Col>
        </Row>
        <Row className="mb-2">
          <Col xs={5} className="fw-semibold">Date of Birth:</Col>
          <Col xs={7}>{user.dob}</Col>
        </Row>
        <Row className="mb-2">
          <Col xs={5} className="fw-semibold">Email:</Col>
          <Col xs={7}>{user.email}</Col>
        </Row>
        <Row className="mb-2">
          <Col xs={5} className="fw-semibold">Username:</Col>
          <Col xs={7}>{user.username}</Col>
        </Row>
        <Row className="mb-2">
          <Col xs={5} className="fw-semibold">Password:</Col>
          <Col xs={7}><span className="text-muted">{user.password}</span></Col>
        </Row>
        <hr />
        <Row className="mb-2">
          <Col xs={5} className="fw-semibold">No. of Strategies:</Col>
          <Col xs={7}>
            <Badge bg="primary" className="me-2">{total} Total</Badge>
            <Badge bg="success" className="me-2">{active} Active</Badge>
            <Badge bg="secondary">{inactive} Inactive</Badge>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
};

export default Account;
