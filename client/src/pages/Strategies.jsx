import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Modal, Button, Nav } from 'react-bootstrap';

const StrategyModal = ({ show, onHide, strategy }) => (
  <Modal show={show} onHide={onHide} size="lg" centered>
    <Modal.Header closeButton>
      <Modal.Title>{strategy?.strategy_name}</Modal.Title>
    </Modal.Header>
    <Modal.Body>
      <p><strong>Description:</strong> {strategy?.description}</p>
      <p><strong>Script:</strong></p>
      <pre className="strategy-code-snippet">{strategy?.script}</pre>
      <p><strong>Created At:</strong> {strategy?.created_at}</p>
      <p><strong>Last Modified At:</strong> {strategy?.last_modified_at}</p>
      <p><strong>Created By:</strong> {strategy?.created_by}</p>
      <p><strong>Last Modified By:</strong> {strategy?.last_modified_by}</p>
      <p><strong>Status:</strong> {strategy?.is_active ? 'Active' : 'Inactive'}</p>
    </Modal.Body>
    <Modal.Footer>
      <Button variant="secondary" onClick={onHide}>Close</Button>
    </Modal.Footer>
  </Modal>
);

const Strategies = ({ appAddress }) => {
  const [strategies, setStrategies] = useState([]);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [modalShow, setModalShow] = useState(false);

  useEffect(() => {
    fetch(`${appAddress}/client/strategies`)
      .then(res => res.json())
      .then(data => setStrategies(data.strategies || []));
  }, [appAddress]);

  const filtered = strategies.filter(s => {
    if (filter === 'active') return s.is_active;
    if (filter === 'inactive') return !s.is_active;
    return true;
  });

// ...existing code up to filtered...
  return (
    <div className="strategies-main-container">
      <Nav
        variant="tabs"
        activeKey={filter}
        onSelect={setFilter}
        className="mb-3 strategies-top-nav d-flex flex-row w-100"
        style={{ background: '#e0e7ef', borderRadius: 6, overflow: 'hidden' }}
      >
        <Nav.Item className="d-flex">
          <Nav.Link eventKey="all">All</Nav.Link>
        </Nav.Item>
        <Nav.Item className="d-flex">
          <Nav.Link eventKey="active">Active</Nav.Link>
        </Nav.Item>
        <Nav.Item className="d-flex">
          <Nav.Link eventKey="inactive">InActive</Nav.Link>
        </Nav.Item>
      </Nav>
      <div className="strategies-list-scroll">
        <div className="row g-3">
          {filtered.map((strategy) => (
            <div className="col-md-6 col-lg-4" key={strategy.strategy_id}>
              <div className="card h-100 shadow-sm">
                <div className="card-body">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <h5 className="mb-0">{strategy.strategy_name}</h5>
                    <span className={`badge ${strategy.is_active ? 'bg-success' : 'bg-secondary'}`}>{strategy.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <p className="card-text">{strategy.description}</p>
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={() => {
                      setSelected(strategy);
                      setModalShow(true);
                    }}
                  >
                    View Details
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <StrategyModal show={modalShow} onHide={() => setModalShow(false)} strategy={selected} />
    </div>
  );
};

export default Strategies;
